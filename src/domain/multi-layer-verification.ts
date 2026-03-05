export type VerificationLayer = "auto_ai" | "agent_validator" | "human_jury";
export type VerificationRiskLevel = "low" | "medium" | "high" | "critical";

const LAYER_COST_CENTS: Record<VerificationLayer, number> = {
  auto_ai: 2,
  agent_validator: 18,
  human_jury: 120,
};

const ORDERED_LAYERS: VerificationLayer[] = ["auto_ai", "agent_validator", "human_jury"];

const MEDIUM_VALUE_THRESHOLD = 5_000;
const HIGH_VALUE_THRESHOLD = 50_000;

export function selectVerificationLayers(
  taskValue: number,
  riskLevel: VerificationRiskLevel,
): VerificationLayer[] {
  if (!Number.isFinite(taskValue) || taskValue < 0) {
    throw new Error("taskValue must be a non-negative number");
  }
  if (!isVerificationRiskLevel(riskLevel)) {
    throw new Error("Invalid riskLevel");
  }

  const normalizedTaskValue = Math.floor(taskValue);
  if (
    riskLevel === "critical" ||
    riskLevel === "high" ||
    normalizedTaskValue >= HIGH_VALUE_THRESHOLD
  ) {
    return [...ORDERED_LAYERS];
  }

  if (riskLevel === "medium" || normalizedTaskValue >= MEDIUM_VALUE_THRESHOLD) {
    return ORDERED_LAYERS.slice(0, 2);
  }

  return ["auto_ai"];
}

export function calculateVerificationCost(layers: VerificationLayer[]): number {
  if (!Array.isArray(layers)) {
    throw new Error("layers must be an array");
  }

  let totalCost = 0;
  const seen = new Set<VerificationLayer>();
  for (const layer of layers) {
    if (!isVerificationLayer(layer)) {
      throw new Error(`Invalid verification layer: ${String(layer)}`);
    }
    if (seen.has(layer)) {
      continue;
    }

    seen.add(layer);
    totalCost += LAYER_COST_CENTS[layer];
  }

  return totalCost;
}

export function isVerificationLayer(value?: string): value is VerificationLayer {
  return value === "auto_ai" || value === "agent_validator" || value === "human_jury";
}

export function isVerificationRiskLevel(value?: string): value is VerificationRiskLevel {
  return value === "low" || value === "medium" || value === "high" || value === "critical";
}
