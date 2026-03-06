import type { EventBus } from "../contracts";
import { DomainEvents } from "../events";
import type {
  ManagedSettlementConnector,
  SettlementConnectorHealth,
  SettlementConnectorRequest,
  SettlementConnectors,
} from "../settlement-connectors";
import type {
  ReconcileSettlementRecordInput,
  SettlementRecord,
  SettlementRecordPage,
  SettlementRecordPageRequest,
  SettlementRecordQueryFilter,
  SettlementRecordReplayPage,
  SettlementRecordReplayRequest,
  SettlementRecordRepository,
} from "../settlement-records";
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

export interface ExecuteSettlementInput {
  model: CompensationModel;
  settlementId?: string;
  idempotencyKey: string;
}

export interface SettlementExecutionResult {
  settlementId: string;
  executedAt: number;
  records: SettlementRecord[];
  idempotencyKey: string;
}

export interface ConnectorHealthReport extends SettlementConnectorHealth {
  connector: SettlementRecord["connector"];
  rail: SettlementRecord["rail"];
}

export type ListSettlementRecordsFilter = SettlementRecordQueryFilter;
export type QuerySettlementRecordsInput = SettlementRecordQueryFilter & SettlementRecordPageRequest;
export type ReplaySettlementRecordLifecycleInput = SettlementRecordReplayRequest;
export { type SettlementRecord } from "../settlement-records";

export interface FailedSettlementExecution {
  settlementId: string;
  idempotencyKey: string;
  failedAt: number;
  error: string;
}

export interface ReconcileSettlementRecordRequest extends ReconcileSettlementRecordInput {
  recordId: string;
}

interface ValuationRecord {
  assetId: string;
  referenceAssetId: string;
  rate: number;
  asOf: number;
  source?: string;
}

export interface PactEconomicsOptions {
  settlementRecordRepository: SettlementRecordRepository;
  eventBus?: EventBus;
  settlementConnectors?: Partial<SettlementConnectors>;
}

export class PactEconomics {
  private readonly assets = new Map<string, CompensationAsset>();
  private readonly valuations = new Map<string, ValuationRecord>();
  private readonly executionFingerprints = new Map<string, string>();
  private readonly executionResults = new Map<string, SettlementExecutionResult>();
  private readonly failedExecutions = new Map<string, FailedSettlementExecution>();
  private readonly settlementRecordRepository: SettlementRecordRepository;
  private readonly eventBus?: EventBus;
  private readonly settlementConnectors?: Partial<SettlementConnectors>;

  constructor(options: PactEconomicsOptions) {
    this.settlementRecordRepository = options.settlementRecordRepository;
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
    const idempotencyKey = this.normalizeIdempotencyKey(input.idempotencyKey);
    const executionFingerprint = this.createExecutionFingerprint(settlementId, input.model);

    const existingFingerprint = this.executionFingerprints.get(idempotencyKey);
    if (existingFingerprint && existingFingerprint !== executionFingerprint) {
      throw new Error(`idempotency key reuse with different settlement payload: ${idempotencyKey}`);
    }

    const existingResult = this.executionResults.get(idempotencyKey);
    if (existingResult) {
      return this.cloneExecutionResult(existingResult);
    }

    this.executionFingerprints.set(idempotencyKey, executionFingerprint);

    try {
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

        const recordId = this.createIdempotentRecordId(idempotencyKey, leg.id);
        const existingRecord = await this.settlementRecordRepository.getById(recordId);
        if (existingRecord) {
          records.push(existingRecord);
          continue;
        }

        const request: SettlementConnectorRequest = {
          settlementId,
          recordId,
          legId: leg.id,
          assetId: leg.assetId,
          payerId: leg.payerId,
          payeeId: leg.payeeId,
          amount: leg.amount,
          unit: leg.unit,
          idempotencyKey: this.createLegIdempotencyKey(idempotencyKey, leg.id),
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

        await this.settlementRecordRepository.append(record);
        records.push(record);
        await this.publishSettlementRecordCreated(settlementId, record);
      }

      const executedAt = Date.now();
      await this.publishSettlementExecuted(settlementId, records.length, executedAt);

      const result: SettlementExecutionResult = {
        settlementId,
        executedAt,
        records,
        idempotencyKey,
      };

      this.executionResults.set(idempotencyKey, this.cloneExecutionResult(result));
      this.failedExecutions.delete(idempotencyKey);

      return this.cloneExecutionResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failedExecutions.set(idempotencyKey, {
        settlementId,
        idempotencyKey,
        failedAt: Date.now(),
        error: message,
      });
      throw error instanceof Error ? error : new Error(message);
    }
  }

  getConnectorHealth(): ConnectorHealthReport[] {
    return [
      this.buildConnectorHealth(
        "llm_metering",
        "llm_token_metering",
        this.settlementConnectors?.llmTokenMetering,
      ),
      this.buildConnectorHealth(
        "cloud_billing",
        "cloud_credit_billing",
        this.settlementConnectors?.cloudCreditBilling,
      ),
      this.buildConnectorHealth(
        "api_quota",
        "api_quota_allocation",
        this.settlementConnectors?.apiQuotaAllocation,
      ),
    ];
  }

  resetConnectorHealth(connector: SettlementRecord["connector"]): ConnectorHealthReport {
    const managedConnector = this.getManagedConnector(connector);
    managedConnector.resetHealth();

    if (connector === "llm_token_metering") {
      return this.buildConnectorHealth("llm_metering", connector, managedConnector);
    }

    if (connector === "cloud_credit_billing") {
      return this.buildConnectorHealth("cloud_billing", connector, managedConnector);
    }

    return this.buildConnectorHealth("api_quota", connector, managedConnector);
  }

  async listSettlementRecords(filter?: ListSettlementRecordsFilter): Promise<SettlementRecord[]> {
    const records: SettlementRecord[] = [];
    let cursor: string | undefined;

    while (true) {
      const page = await this.settlementRecordRepository.query(filter, {
        cursor,
        limit: 200,
      });
      records.push(...page.items);
      if (!page.nextCursor) {
        return records;
      }
      cursor = page.nextCursor;
    }
  }

  async querySettlementRecords(
    input: QuerySettlementRecordsInput = {},
  ): Promise<SettlementRecordPage> {
    const filter: SettlementRecordQueryFilter = {
      settlementId: input.settlementId,
      assetId: input.assetId,
      rail: input.rail,
      payerId: input.payerId,
      payeeId: input.payeeId,
      status: input.status,
      reconciledBy: input.reconciledBy,
    };

    return this.settlementRecordRepository.query(filter, {
      cursor: input.cursor,
      limit: input.limit,
    });
  }

  async replaySettlementRecordLifecycle(
    input: ReplaySettlementRecordLifecycleInput = {},
  ): Promise<SettlementRecordReplayPage> {
    return this.settlementRecordRepository.replay(input);
  }

  listFailedSettlementExecutions(): FailedSettlementExecution[] {
    return [...this.failedExecutions.values()]
      .map((entry) => ({ ...entry }))
      .sort((left, right) => {
        if (left.failedAt === right.failedAt) {
          if (left.settlementId === right.settlementId) {
            return left.idempotencyKey.localeCompare(right.idempotencyKey);
          }
          return left.settlementId.localeCompare(right.settlementId);
        }
        return left.failedAt - right.failedAt;
      });
  }

  async reconcileSettlementRecord(
    input: ReconcileSettlementRecordRequest,
  ): Promise<SettlementRecord> {
    const reconciled = await this.settlementRecordRepository.reconcile(input.recordId, {
      reconciledBy: input.reconciledBy,
      note: input.note,
      reconciledAt: input.reconciledAt,
    });
    await this.publishSettlementRecordReconciled(reconciled.settlementId, reconciled);
    return reconciled;
  }

  async getSettlementRecord(recordId: string): Promise<SettlementRecord | undefined> {
    return this.settlementRecordRepository.getById(recordId);
  }

  async canReconcileSettlementRecord(record: SettlementRecord): Promise<boolean> {
    const connector = this.getManagedConnector(record.connector);
    return connector.hasExternalReference(record.externalReference);
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

  private buildConnectorHealth(
    rail: SettlementRecord["rail"],
    connectorName: SettlementRecord["connector"],
    connector: ManagedSettlementConnector | undefined,
  ): ConnectorHealthReport {
    if (!connector) {
      return {
        rail,
        connector: connectorName,
        state: "open",
        retryPolicy: {
          maxRetries: 0,
          backoffMs: 0,
        },
        circuitBreaker: {
          failureThreshold: 0,
          cooldownMs: 0,
        },
        consecutiveFailures: 1,
        lastFailureAt: Date.now(),
        lastError: `missing connector: ${connectorName}`,
        lastFailure: {
          attempt: 0,
          failedAt: Date.now(),
          message: `missing connector: ${connectorName}`,
          settlementId: "",
          recordId: "",
        },
      };
    }

    return {
      rail,
      connector: connectorName,
      ...connector.getHealth(),
    };
  }

  private getManagedConnector(
    connector: SettlementRecord["connector"],
  ): ManagedSettlementConnector {
    if (connector === "llm_token_metering") {
      if (!this.settlementConnectors?.llmTokenMetering) {
        throw new Error("missing connector: llmTokenMetering");
      }
      return this.settlementConnectors.llmTokenMetering;
    }

    if (connector === "cloud_credit_billing") {
      if (!this.settlementConnectors?.cloudCreditBilling) {
        throw new Error("missing connector: cloudCreditBilling");
      }
      return this.settlementConnectors.cloudCreditBilling;
    }

    if (!this.settlementConnectors?.apiQuotaAllocation) {
      throw new Error("missing connector: apiQuotaAllocation");
    }

    return this.settlementConnectors.apiQuotaAllocation;
  }

  private createExecutionFingerprint(settlementId: string, model: CompensationModel): string {
    return JSON.stringify({
      settlementId,
      mode: model.mode,
      settlementWindowSec: model.settlementWindowSec,
      metadata: model.metadata,
      legs: [...model.legs]
        .map((leg) => ({
          id: leg.id,
          payerId: leg.payerId,
          payeeId: leg.payeeId,
          assetId: leg.assetId,
          amount: leg.amount,
          unit: leg.unit,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    });
  }

  private createIdempotentRecordId(idempotencyKey: string, legId: string): string {
    return `settlement-record-${this.normalizeIdempotencyComponent(idempotencyKey)}-${this.normalizeIdempotencyComponent(legId)}`;
  }

  private createLegIdempotencyKey(idempotencyKey: string, legId: string): string {
    return `${idempotencyKey}:${legId}`;
  }

  private normalizeIdempotencyComponent(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80);
  }

  private normalizeIdempotencyKey(value: string): string {
    if (typeof value !== "string") {
      throw new Error("idempotencyKey is required");
    }

    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error("idempotencyKey is required");
    }

    return trimmed;
  }

  private cloneExecutionResult(result: SettlementExecutionResult): SettlementExecutionResult {
    return {
      ...result,
      records: result.records.map((record) => ({
        ...record,
        connectorMetadata: record.connectorMetadata ? { ...record.connectorMetadata } : undefined,
      })),
    };
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

  private async publishSettlementRecordReconciled(
    settlementId: string,
    record: SettlementRecord,
  ): Promise<void> {
    if (!this.eventBus) {
      return;
    }

    await this.eventBus.publish({
      name: DomainEvents.EconomicsSettlementRecordReconciled,
      payload: {
        settlementId,
        record,
      },
      createdAt: Date.now(),
    });
  }
}
