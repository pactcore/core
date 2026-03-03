import type { EventBus } from "../contracts";
import { DomainEvents } from "../events";
import type {
  SettlementConnectorRequest,
  SettlementConnectors,
} from "../settlement-connectors";
import { generateId } from "../utils";
import {
  groupCompensationByAsset,
  validateCompensationModel,
  type CompensationAsset,
  type CompensationModel,
} from "../../domain/economics";

export interface RegisterCompensationAssetInput {
  id?: string;
  kind: CompensationAsset["kind"];
  symbol: string;
  network?: string;
  issuer?: string;
  metadata?: Record<string, string>;
}

export interface RegisterValuationInput {
  assetId: string;
  referenceAssetId: string;
  rate: number;
  asOf?: number;
  source?: string;
}

export interface BuildCompensationModelInput {
  mode: CompensationModel["mode"];
  settlementWindowSec?: number;
  metadata?: Record<string, string>;
  legs: CompensationModel["legs"];
}

export interface CompensationQuote {
  model: CompensationModel;
  totalsByAsset: Record<string, number>;
}

export interface ValuationQuote {
  referenceAssetId: string;
  totalsByAsset: Record<string, number>;
  convertedByAsset: Record<string, number>;
  totalInReference: number;
  missingAssetIds: string[];
}

export interface AssetSettlementLine {
  assetId: string;
  amount: number;
  rail: "onchain_stablecoin" | "llm_metering" | "cloud_billing" | "api_quota" | "custom";
  unit?: string;
}

export interface SettlementPlan {
  id: string;
  createdAt: number;
  lines: AssetSettlementLine[];
}

export interface SettlementRecord {
  id: string;
  settlementId: string;
  legId: string;
  assetId: string;
  rail: "llm_metering" | "cloud_billing" | "api_quota";
  connector: "llm_token_metering" | "cloud_credit_billing" | "api_quota_allocation";
  payerId: string;
  payeeId: string;
  amount: number;
  unit: string;
  status: "applied";
  externalReference: string;
  connectorMetadata?: Record<string, string>;
  createdAt: number;
}

export interface ExecuteSettlementInput {
  model: CompensationModel;
  settlementId?: string;
}

export interface SettlementExecutionResult {
  settlementId: string;
  executedAt: number;
  records: SettlementRecord[];
}

export interface ListSettlementRecordsFilter {
  settlementId?: string;
  assetId?: string;
  rail?: SettlementRecord["rail"];
  payerId?: string;
  payeeId?: string;
}

interface ValuationRecord {
  assetId: string;
  referenceAssetId: string;
  rate: number;
  asOf: number;
  source?: string;
}

export interface PactEconomicsOptions {
  eventBus?: EventBus;
  settlementConnectors?: Partial<SettlementConnectors>;
}

export class PactEconomics {
  private readonly assets = new Map<string, CompensationAsset>();
  private readonly valuations = new Map<string, ValuationRecord>();
  private readonly settlementRecords = new Map<string, SettlementRecord>();
  private readonly eventBus?: EventBus;
  private readonly settlementConnectors?: Partial<SettlementConnectors>;

  constructor(options: PactEconomicsOptions = {}) {
    this.eventBus = options.eventBus;
    this.settlementConnectors = options.settlementConnectors;
  }

  async registerAsset(input: RegisterCompensationAssetInput): Promise<CompensationAsset> {
    const asset: CompensationAsset = {
      id: input.id ?? generateId("asset"),
      kind: input.kind,
      symbol: input.symbol,
      network: input.network,
      issuer: input.issuer,
      metadata: input.metadata,
    };

    this.assets.set(asset.id, asset);
    return asset;
  }

  async listAssets(): Promise<CompensationAsset[]> {
    return [...this.assets.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  async registerValuation(input: RegisterValuationInput): Promise<ValuationRecord> {
    if (!Number.isFinite(input.rate) || input.rate <= 0) {
      throw new Error("valuation rate must be a positive number");
    }

    if (!this.assets.has(input.assetId)) {
      throw new Error(`unknown assetId for valuation: ${input.assetId}`);
    }

    if (!this.assets.has(input.referenceAssetId)) {
      throw new Error(`unknown referenceAssetId for valuation: ${input.referenceAssetId}`);
    }

    const record: ValuationRecord = {
      assetId: input.assetId,
      referenceAssetId: input.referenceAssetId,
      rate: input.rate,
      asOf: input.asOf ?? Date.now(),
      source: input.source,
    };

    this.valuations.set(this.valuationKey(record.assetId, record.referenceAssetId), record);
    return record;
  }

  async listValuations(referenceAssetId?: string): Promise<ValuationRecord[]> {
    const values = [...this.valuations.values()];
    const filtered = referenceAssetId
      ? values.filter((valuation) => valuation.referenceAssetId === referenceAssetId)
      : values;

    return filtered.sort((a, b) => a.assetId.localeCompare(b.assetId));
  }

  async buildCompensationModel(input: BuildCompensationModelInput): Promise<CompensationModel> {
    const model: CompensationModel = {
      mode: input.mode,
      settlementWindowSec: input.settlementWindowSec,
      metadata: input.metadata,
      legs: input.legs,
    };

    const validation = validateCompensationModel(model, await this.listAssets());
    if (!validation.valid) {
      throw new Error(`Invalid compensation model: ${validation.reasons.join("; ")}`);
    }

    return model;
  }

  async quoteCompensation(model: CompensationModel): Promise<CompensationQuote> {
    const validation = validateCompensationModel(model, await this.listAssets());
    if (!validation.valid) {
      throw new Error(`Invalid compensation model: ${validation.reasons.join("; ")}`);
    }

    return {
      model,
      totalsByAsset: groupCompensationByAsset(model),
    };
  }

  async quoteInReference(
    model: CompensationModel,
    referenceAssetId: string,
  ): Promise<ValuationQuote> {
    const baseQuote = await this.quoteCompensation(model);
    if (!this.assets.has(referenceAssetId)) {
      throw new Error(`unknown reference asset: ${referenceAssetId}`);
    }

    const convertedByAsset: Record<string, number> = {};
    const missingAssetIds: string[] = [];
    let totalInReference = 0;

    for (const [assetId, amount] of Object.entries(baseQuote.totalsByAsset)) {
      if (assetId === referenceAssetId) {
        convertedByAsset[assetId] = amount;
        totalInReference += amount;
        continue;
      }

      const valuation = this.valuations.get(this.valuationKey(assetId, referenceAssetId));
      if (!valuation) {
        missingAssetIds.push(assetId);
        continue;
      }

      const converted = amount * valuation.rate;
      convertedByAsset[assetId] = converted;
      totalInReference += converted;
    }

    return {
      referenceAssetId,
      totalsByAsset: baseQuote.totalsByAsset,
      convertedByAsset,
      totalInReference,
      missingAssetIds,
    };
  }

  async planSettlement(model: CompensationModel): Promise<SettlementPlan> {
    const quote = await this.quoteCompensation(model);
    const lines: AssetSettlementLine[] = Object.entries(quote.totalsByAsset)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([assetId, amount]) => {
        const asset = this.assets.get(assetId);
        if (!asset) {
          throw new Error(`unknown asset in settlement plan: ${assetId}`);
        }

        return {
          assetId,
          amount,
          rail: this.resolveSettlementRail(asset.kind),
          unit: asset.symbol,
        };
      });

    return {
      id: generateId("settlement-plan"),
      createdAt: Date.now(),
      lines,
    };
  }

  async executeSettlement(input: ExecuteSettlementInput): Promise<SettlementExecutionResult> {
    const modelValidation = validateCompensationModel(input.model, await this.listAssets());
    if (!modelValidation.valid) {
      throw new Error(`Invalid compensation model: ${modelValidation.reasons.join("; ")}`);
    }

    const settlementId = input.settlementId ?? generateId("settlement");
    const records: SettlementRecord[] = [];
    const legs = [...input.model.legs].sort((a, b) => a.id.localeCompare(b.id));

    for (const leg of legs) {
      const asset = this.assets.get(leg.assetId);
      if (!asset) {
        throw new Error(`unknown asset in settlement execution: ${leg.assetId}`);
      }

      const rail = this.resolveSettlementRail(asset.kind);
      if (rail === "onchain_stablecoin" || rail === "custom") {
        continue;
      }

      const recordId = generateId("settlement-record");
      const request: SettlementConnectorRequest = {
        settlementId,
        recordId,
        legId: leg.id,
        assetId: leg.assetId,
        payerId: leg.payerId,
        payeeId: leg.payeeId,
        amount: leg.amount,
        unit: leg.unit,
      };

      const connectorResult = await this.applyConnectorByRail(rail, request);
      const record: SettlementRecord = {
        id: recordId,
        settlementId,
        legId: leg.id,
        assetId: leg.assetId,
        rail,
        connector: connectorResult.connector,
        payerId: leg.payerId,
        payeeId: leg.payeeId,
        amount: leg.amount,
        unit: leg.unit,
        status: connectorResult.result.status,
        externalReference: connectorResult.result.externalReference,
        connectorMetadata: connectorResult.result.metadata,
        createdAt: connectorResult.result.processedAt,
      };

      this.settlementRecords.set(record.id, record);
      records.push(record);
      await this.publishSettlementRecordCreated(settlementId, record);
    }

    const executedAt = Date.now();
    await this.publishSettlementExecuted(settlementId, records.length, executedAt);

    return {
      settlementId,
      executedAt,
      records,
    };
  }

  async listSettlementRecords(filter?: ListSettlementRecordsFilter): Promise<SettlementRecord[]> {
    return [...this.settlementRecords.values()]
      .filter((record) => {
        if (!filter) {
          return true;
        }
        if (filter.settlementId && record.settlementId !== filter.settlementId) {
          return false;
        }
        if (filter.assetId && record.assetId !== filter.assetId) {
          return false;
        }
        if (filter.rail && record.rail !== filter.rail) {
          return false;
        }
        if (filter.payerId && record.payerId !== filter.payerId) {
          return false;
        }
        if (filter.payeeId && record.payeeId !== filter.payeeId) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.createdAt === b.createdAt) {
          return a.id.localeCompare(b.id);
        }
        return a.createdAt - b.createdAt;
      });
  }

  async getSettlementRecord(recordId: string): Promise<SettlementRecord | undefined> {
    return this.settlementRecords.get(recordId);
  }

  private valuationKey(assetId: string, referenceAssetId: string): string {
    return `${assetId}->${referenceAssetId}`;
  }

  private resolveSettlementRail(kind: CompensationAsset["kind"]): AssetSettlementLine["rail"] {
    switch (kind) {
      case "usdc":
      case "stablecoin":
        return "onchain_stablecoin";
      case "llm_token":
        return "llm_metering";
      case "cloud_credit":
        return "cloud_billing";
      case "api_quota":
        return "api_quota";
      default:
        return "custom";
    }
  }

  private async applyConnectorByRail(
    rail: SettlementRecord["rail"],
    request: SettlementConnectorRequest,
  ): Promise<{
    connector: SettlementRecord["connector"];
    result: Awaited<ReturnType<SettlementConnectors["llmTokenMetering"]["applyMeteringCredit"]>>;
  }> {
    if (rail === "llm_metering") {
      if (!this.settlementConnectors?.llmTokenMetering) {
        throw new Error("missing connector: llmTokenMetering");
      }
      const result = await this.settlementConnectors.llmTokenMetering.applyMeteringCredit(request);
      return { connector: "llm_token_metering", result };
    }

    if (rail === "cloud_billing") {
      if (!this.settlementConnectors?.cloudCreditBilling) {
        throw new Error("missing connector: cloudCreditBilling");
      }
      const result = await this.settlementConnectors.cloudCreditBilling.applyBillingCredit(request);
      return { connector: "cloud_credit_billing", result };
    }

    if (!this.settlementConnectors?.apiQuotaAllocation) {
      throw new Error("missing connector: apiQuotaAllocation");
    }

    const result = await this.settlementConnectors.apiQuotaAllocation.allocateQuota(request);
    return { connector: "api_quota_allocation", result };
  }

  private async publishSettlementRecordCreated(
    settlementId: string,
    record: SettlementRecord,
  ): Promise<void> {
    if (!this.eventBus) {
      return;
    }

    await this.eventBus.publish({
      name: DomainEvents.EconomicsSettlementRecordCreated,
      payload: {
        settlementId,
        record,
      },
      createdAt: Date.now(),
    });
  }

  private async publishSettlementExecuted(
    settlementId: string,
    recordCount: number,
    executedAt: number,
  ): Promise<void> {
    if (!this.eventBus) {
      return;
    }

    await this.eventBus.publish({
      name: DomainEvents.EconomicsSettlementExecuted,
      payload: {
        settlementId,
        recordCount,
        executedAt,
      },
      createdAt: Date.now(),
    });
  }
}
