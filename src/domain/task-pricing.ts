export type UrgencyLevel = "low" | "normal" | "high" | "critical";
export type ComplexityLevel = "simple" | "standard" | "complex" | "expert";

export interface TaskRequirements {
  basePriceCents: number;
  urgency: UrgencyLevel | number;
  complexity: ComplexityLevel | number;
}

export interface MarketState {
  supplyCount: number;
  demandCount: number;
  clearingPriceCents?: number;
}

export interface PricingSuggestion {
  suggestedPriceCents: number;
  appliedBasePriceCents: number;
  supplyDemandRatio: number;
  surgeMultiplier: number;
  urgencyMultiplier: number;
  complexityMultiplier: number;
}

export interface DynamicPricingConfig {
  minimumPriceCents: number;
  maximumPriceMultiplier: number;
  minimumSurgeMultiplier: number;
  maximumSurgeMultiplier: number;
}

const DEFAULT_PRICING_CONFIG: DynamicPricingConfig = {
  minimumPriceCents: 100,
  maximumPriceMultiplier: 4,
  minimumSurgeMultiplier: 0.7,
  maximumSurgeMultiplier: 2.5,
};

export class DynamicPricingModel {
  private readonly config: DynamicPricingConfig;

  constructor(config: Partial<DynamicPricingConfig> = {}) {
    this.config = {
      ...DEFAULT_PRICING_CONFIG,
      ...config,
    };
    validateConfig(this.config);
  }

  suggestPrice(taskRequirements: TaskRequirements, marketState: MarketState): PricingSuggestion {
    assertFinitePositiveInteger(taskRequirements.basePriceCents, "basePriceCents");
    assertNonNegativeInteger(marketState.supplyCount, "supplyCount");
    assertNonNegativeInteger(marketState.demandCount, "demandCount");
    if (
      marketState.clearingPriceCents !== undefined &&
      (!Number.isInteger(marketState.clearingPriceCents) || marketState.clearingPriceCents <= 0)
    ) {
      throw new Error("clearingPriceCents must be a positive integer when provided");
    }

    const ratio = deriveSupplyDemandRatio(marketState);
    const surgeMultiplier = clamp(
      rawSurgeMultiplier(ratio),
      this.config.minimumSurgeMultiplier,
      this.config.maximumSurgeMultiplier,
    );
    const urgencyMultiplier = urgencyToMultiplier(taskRequirements.urgency);
    const complexityMultiplier = complexityToMultiplier(taskRequirements.complexity);

    const marketAnchor = marketState.clearingPriceCents ?? taskRequirements.basePriceCents;
    const appliedBasePriceCents = Math.max(
      taskRequirements.basePriceCents,
      Math.round(marketAnchor * 0.85),
    );

    const rawSuggestedPrice =
      appliedBasePriceCents * surgeMultiplier * urgencyMultiplier * complexityMultiplier;
    const maxAllowedPrice = Math.round(taskRequirements.basePriceCents * this.config.maximumPriceMultiplier);
    const suggestedPriceCents = clampInt(
      Math.round(rawSuggestedPrice),
      this.config.minimumPriceCents,
      maxAllowedPrice,
    );

    return {
      suggestedPriceCents,
      appliedBasePriceCents,
      supplyDemandRatio: roundTo(ratio, 4),
      surgeMultiplier: roundTo(surgeMultiplier, 4),
      urgencyMultiplier: roundTo(urgencyMultiplier, 4),
      complexityMultiplier: roundTo(complexityMultiplier, 4),
    };
  }

  calculateSurgeMultiplier(supplyDemandRatio: number): number {
    return clamp(
      roundTo(rawSurgeMultiplier(supplyDemandRatio), 4),
      this.config.minimumSurgeMultiplier,
      this.config.maximumSurgeMultiplier,
    );
  }
}

export function suggestPrice(
  taskRequirements: TaskRequirements,
  marketState: MarketState,
): PricingSuggestion {
  return new DynamicPricingModel().suggestPrice(taskRequirements, marketState);
}

export function calculateSurgeMultiplier(supplyDemandRatio: number): number {
  return new DynamicPricingModel().calculateSurgeMultiplier(supplyDemandRatio);
}

function deriveSupplyDemandRatio(marketState: MarketState): number {
  const { supplyCount, demandCount } = marketState;
  if (supplyCount === 0 && demandCount === 0) {
    return 1;
  }
  if (demandCount === 0) {
    return 100;
  }
  if (supplyCount === 0) {
    return 0.01;
  }
  return supplyCount / demandCount;
}

function rawSurgeMultiplier(supplyDemandRatio: number): number {
  if (!Number.isFinite(supplyDemandRatio)) {
    throw new Error("supplyDemandRatio must be a finite number");
  }
  if (supplyDemandRatio <= 0) {
    return DEFAULT_PRICING_CONFIG.maximumSurgeMultiplier;
  }
  if (supplyDemandRatio === 1) {
    return 1;
  }

  if (supplyDemandRatio < 1) {
    return Math.pow(1 / supplyDemandRatio, 0.5);
  }
  return 1 / Math.pow(supplyDemandRatio, 0.35);
}

function urgencyToMultiplier(value: UrgencyLevel | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("urgency must be finite");
    }
    return 0.85 + clamp(value, 0, 1) * 0.7;
  }

  switch (value) {
    case "low":
      return 0.9;
    case "normal":
      return 1;
    case "high":
      return 1.2;
    case "critical":
      return 1.45;
  }
}

function complexityToMultiplier(value: ComplexityLevel | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("complexity must be finite");
    }
    return 0.9 + clamp(value, 0, 1) * 0.8;
  }

  switch (value) {
    case "simple":
      return 0.9;
    case "standard":
      return 1;
    case "complex":
      return 1.25;
    case "expert":
      return 1.5;
  }
}

function validateConfig(config: DynamicPricingConfig): void {
  assertFinitePositiveInteger(config.minimumPriceCents, "minimumPriceCents");
  if (!Number.isFinite(config.maximumPriceMultiplier) || config.maximumPriceMultiplier <= 1) {
    throw new Error("maximumPriceMultiplier must be greater than 1");
  }
  if (
    !Number.isFinite(config.minimumSurgeMultiplier) ||
    !Number.isFinite(config.maximumSurgeMultiplier) ||
    config.minimumSurgeMultiplier <= 0 ||
    config.maximumSurgeMultiplier <= 0 ||
    config.minimumSurgeMultiplier > config.maximumSurgeMultiplier
  ) {
    throw new Error("invalid surge multiplier bounds");
  }
}

function assertFinitePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function roundTo(value: number, decimals: number): number {
  const precision = Math.pow(10, decimals);
  return Math.round(value * precision) / precision;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}
