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

interface ValuationRecord {
  assetId: string;
  referenceAssetId: string;
  rate: number;
  asOf: number;
  source?: string;
}

export class PactEconomics {
  private readonly assets = new Map<string, CompensationAsset>();
  private readonly valuations = new Map<string, ValuationRecord>();

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
    const assets = this.assets;
    const lines: AssetSettlementLine[] = Object.entries(quote.totalsByAsset)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([assetId, amount]) => {
        const asset = assets.get(assetId);
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
}
