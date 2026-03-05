import { describe, expect, test } from "bun:test";
import {
  calculateJobCost,
  defaultPricingTable,
  findBestTier,
  type ResourceTier,
} from "../src/domain/compute-pricing";
import { PricingEngine } from "../src/infrastructure/compute/pricing-engine";

describe("compute pricing", () => {
  test("calculates zero cost for non-positive durations", () => {
    const tier = defaultPricingTable.tiers[0] as ResourceTier;
    expect(calculateJobCost(tier, 0)).toBe(0);
    expect(calculateJobCost(tier, -30)).toBe(0);
  });

  test("calculates one-hour cost for each default tier", () => {
    for (const tier of defaultPricingTable.tiers) {
      expect(calculateJobCost(tier, 3_600)).toBe(tier.pricePerHourCents);
    }
  });

  test("finds lowest-cost tier that satisfies CPU and memory requirements", () => {
    const tier = findBestTier({
      cpuCores: 2,
      memoryMB: 4_096,
      gpuCount: 0,
    });

    expect(tier?.name).toBe("Container Med");
  });

  test("finds GPU model-specific tier when requested", () => {
    const tier = findBestTier({
      cpuCores: 4,
      memoryMB: 16_384,
      gpuCount: 1,
      gpuModel: "T4",
    });

    expect(tier?.name).toBe("GPU T4");
  });

  test("returns undefined when no tier satisfies requirements", () => {
    const tier = findBestTier({
      cpuCores: 512,
      memoryMB: 2_000_000,
      gpuCount: 8,
      gpuModel: "H200",
    });

    expect(tier).toBeUndefined();
  });

  test("pricing engine quote returns expected tier and estimated cost", () => {
    const engine = new PricingEngine(defaultPricingTable);
    const quote = engine.quoteCost(
      {
        cpuCores: 8,
        memoryMB: 32_000,
        gpuCount: 0,
      },
      1_800,
    );

    expect(quote?.tier.name).toBe("VM Large");
    expect(quote?.estimatedCostCents).toBe(12);
  });

  test("pricing engine lists all tiers", () => {
    const engine = new PricingEngine(defaultPricingTable);
    const tiers = engine.listTiers();

    expect(tiers).toHaveLength(defaultPricingTable.tiers.length);
    expect(tiers.map((tier) => tier.name)).toContain("GPU A100");
  });
});
