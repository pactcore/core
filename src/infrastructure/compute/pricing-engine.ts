import {
  calculateJobCost,
  defaultPricingTable,
  findBestTier,
  type PricingTable,
  type ResourceTier,
} from "../../domain/compute-pricing";
import type { ComputeProviderCapabilities } from "../../domain/types";

export interface PricingQuote {
  tier: ResourceTier;
  estimatedCostCents: number;
}

export class PricingEngine {
  constructor(private readonly pricingTable: PricingTable = defaultPricingTable) {}

  quoteCost(
    capabilities: ComputeProviderCapabilities,
    estimatedDurationSeconds: number,
  ): PricingQuote | undefined {
    const tier = findBestTier(capabilities, this.pricingTable);
    if (!tier) {
      return undefined;
    }

    return {
      tier,
      estimatedCostCents: calculateJobCost(tier, estimatedDurationSeconds),
    };
  }

  listTiers(): ResourceTier[] {
    return [...this.pricingTable.tiers];
  }
}
