export type CompensationAssetKind =
  | "usdc"
  | "stablecoin"
  | "llm_token"
  | "cloud_credit"
  | "api_quota"
  | "custom";

export interface CompensationAsset {
  id: string;
  kind: CompensationAssetKind;
  symbol: string;
  network?: string;
  issuer?: string;
  metadata?: Record<string, string>;
}

export interface CompensationLeg {
  id: string;
  payerId: string;
  payeeId: string;
  assetId: string;
  amount: number;
  unit: string;
  description?: string;
}

export interface CompensationModel {
  mode: "single_asset" | "multi_asset";
  legs: CompensationLeg[];
  settlementWindowSec?: number;
  metadata?: Record<string, string>;
}

export interface CompensationValidationResult {
  valid: boolean;
  reasons: string[];
}

export function validateCompensationModel(
  model: CompensationModel,
  knownAssets?: CompensationAsset[],
): CompensationValidationResult {
  const reasons: string[] = [];

  if (!model.legs.length) {
    reasons.push("compensation model must contain at least one leg");
  }

  if (model.mode === "single_asset") {
    const distinctAssets = new Set(model.legs.map((leg) => leg.assetId));
    if (distinctAssets.size > 1) {
      reasons.push("single_asset mode cannot include multiple asset ids");
    }
  }

  for (const leg of model.legs) {
    if (!Number.isFinite(leg.amount) || leg.amount <= 0) {
      reasons.push(`invalid amount on compensation leg ${leg.id}`);
    }
    if (!leg.payerId || !leg.payeeId) {
      reasons.push(`payer/payee required on compensation leg ${leg.id}`);
    }
    if (leg.payerId === leg.payeeId) {
      reasons.push(`payer and payee cannot be identical on leg ${leg.id}`);
    }
    if (!leg.assetId) {
      reasons.push(`assetId required on compensation leg ${leg.id}`);
    }
    if (!leg.unit) {
      reasons.push(`unit required on compensation leg ${leg.id}`);
    }
  }

  if (knownAssets && knownAssets.length > 0) {
    const knownAssetIds = new Set(knownAssets.map((asset) => asset.id));
    for (const leg of model.legs) {
      if (!knownAssetIds.has(leg.assetId)) {
        reasons.push(`unknown assetId on compensation leg ${leg.id}: ${leg.assetId}`);
      }
    }
  }

  return {
    valid: reasons.length === 0,
    reasons,
  };
}

export function groupCompensationByAsset(model: CompensationModel): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const leg of model.legs) {
    totals[leg.assetId] = (totals[leg.assetId] ?? 0) + leg.amount;
  }
  return totals;
}
