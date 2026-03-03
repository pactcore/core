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

export class PactEconomics {
  private readonly assets = new Map<string, CompensationAsset>();

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
}
