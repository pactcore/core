import { describe, expect, it } from "bun:test";
import {
  calculateEquilibrium,
  calculateWelfare,
  simulateMarketDynamics,
  type MarketEquilibrium,
  type SupplyDemandCurve,
} from "../src/domain/labor-market";
import {
  DynamicPricingModel,
  calculateSurgeMultiplier,
  suggestPrice,
} from "../src/domain/task-pricing";

const baseSupplyCurve: SupplyDemandCurve = {
  points: [
    { priceCents: 100, quantity: 40 },
    { priceCents: 200, quantity: 80 },
  ],
};

const baseDemandCurve: SupplyDemandCurve = {
  points: [
    { priceCents: 100, quantity: 100 },
    { priceCents: 200, quantity: 60 },
  ],
};

describe("labor market equilibrium", () => {
  it("calculates a clearing price where supply and demand intersect", () => {
    const equilibrium = calculateEquilibrium(baseSupplyCurve, baseDemandCurve);

    expect(equilibrium.clearingPriceCents).toBe(175);
    expect(equilibrium.supplyCount).toBe(70);
    expect(equilibrium.demandCount).toBe(70);
    expect(equilibrium.matchRate).toBe(1);
    expect(equilibrium.surplusWorkers).toBe(0);
    expect(equilibrium.surplusTasks).toBe(0);
  });

  it("detects excess demand when demand remains above supply", () => {
    const equilibrium = calculateEquilibrium(
      {
        points: [
          { priceCents: 100, quantity: 50 },
          { priceCents: 200, quantity: 90 },
        ],
      },
      {
        points: [
          { priceCents: 100, quantity: 140 },
          { priceCents: 200, quantity: 110 },
        ],
      },
    );

    expect(equilibrium.clearingPriceCents).toBe(200);
    expect(equilibrium.supplyCount).toBe(90);
    expect(equilibrium.demandCount).toBe(110);
    expect(equilibrium.surplusTasks).toBe(20);
    expect(equilibrium.surplusWorkers).toBe(0);
  });

  it("detects excess supply when supply remains above demand", () => {
    const equilibrium = calculateEquilibrium(
      {
        points: [
          { priceCents: 100, quantity: 120 },
          { priceCents: 200, quantity: 160 },
        ],
      },
      {
        points: [
          { priceCents: 100, quantity: 80 },
          { priceCents: 200, quantity: 40 },
        ],
      },
    );

    expect(equilibrium.clearingPriceCents).toBe(100);
    expect(equilibrium.supplyCount).toBe(120);
    expect(equilibrium.demandCount).toBe(80);
    expect(equilibrium.matchRate).toBe(0.6667);
    expect(equilibrium.surplusWorkers).toBe(40);
    expect(equilibrium.surplusTasks).toBe(0);
  });

  it("simulates multi-period market dynamics with growth effects", () => {
    const snapshots = simulateMarketDynamics(
      {
        supplyCurve: {
          points: [
            { priceCents: 100, quantity: 60 },
            { priceCents: 200, quantity: 100 },
          ],
        },
        demandCurve: {
          points: [
            { priceCents: 100, quantity: 120 },
            { priceCents: 200, quantity: 80 },
          ],
        },
        supplyGrowthRate: 0,
        demandGrowthRate: 0.1,
        volatility: 0,
      },
      4,
    );

    expect(snapshots).toHaveLength(4);
    expect(snapshots[0]?.clearingPriceCents).toBe(175);
    expect((snapshots[3]?.clearingPriceCents ?? 0)).toBeGreaterThan(
      snapshots[0]?.clearingPriceCents ?? 0,
    );
  });
});

describe("labor market welfare", () => {
  it("increases total welfare when more market demand is matched", () => {
    const lowMatchEquilibrium: MarketEquilibrium = {
      supplyCount: 100,
      demandCount: 40,
      clearingPriceCents: 150,
      matchRate: 0.4,
      surplusWorkers: 60,
      surplusTasks: 0,
    };
    const highMatchEquilibrium: MarketEquilibrium = {
      supplyCount: 100,
      demandCount: 95,
      clearingPriceCents: 150,
      matchRate: 0.95,
      surplusWorkers: 5,
      surplusTasks: 0,
    };

    const lowWelfare = calculateWelfare(lowMatchEquilibrium);
    const highWelfare = calculateWelfare(highMatchEquilibrium);

    expect(highWelfare.totalWelfareCents).toBeGreaterThan(lowWelfare.totalWelfareCents);
    expect(highWelfare.deadweightLossCents).toBeLessThan(lowWelfare.deadweightLossCents);
  });

  it("reports deadweight loss when no trades are matched", () => {
    const welfare = calculateWelfare({
      supplyCount: 20,
      demandCount: 0,
      clearingPriceCents: 300,
      matchRate: 0,
      surplusWorkers: 20,
      surplusTasks: 0,
    });

    expect(welfare.matchedCount).toBe(0);
    expect(welfare.deadweightLossCents).toBe(6_000);
    expect(welfare.totalWelfareCents).toBeLessThan(0);
  });
});

describe("task dynamic pricing", () => {
  it("returns neutral surge multiplier at balanced supply and demand", () => {
    expect(calculateSurgeMultiplier(1)).toBe(1);
  });

  it("increases surge multiplier when labor supply is scarce", () => {
    expect(calculateSurgeMultiplier(0.5)).toBeGreaterThan(1);
    expect(calculateSurgeMultiplier(2)).toBeLessThan(1);
  });

  it("suggests higher prices for urgent and complex tasks", () => {
    const lowIntensity = suggestPrice(
      {
        basePriceCents: 1_000,
        urgency: "low",
        complexity: "simple",
      },
      {
        supplyCount: 30,
        demandCount: 90,
      },
    );
    const highIntensity = suggestPrice(
      {
        basePriceCents: 1_000,
        urgency: "critical",
        complexity: "expert",
      },
      {
        supplyCount: 30,
        demandCount: 90,
      },
    );

    expect(lowIntensity.surgeMultiplier).toBeGreaterThan(1);
    expect(highIntensity.suggestedPriceCents).toBeGreaterThan(lowIntensity.suggestedPriceCents);
  });

  it("suggests lower prices under oversupplied labor conditions", () => {
    const shortage = suggestPrice(
      {
        basePriceCents: 1_000,
        urgency: "normal",
        complexity: "standard",
      },
      {
        supplyCount: 20,
        demandCount: 80,
      },
    );
    const oversupply = suggestPrice(
      {
        basePriceCents: 1_000,
        urgency: "normal",
        complexity: "standard",
      },
      {
        supplyCount: 120,
        demandCount: 40,
      },
    );

    expect(shortage.suggestedPriceCents).toBeGreaterThan(oversupply.suggestedPriceCents);
  });

  it("applies configured caps in DynamicPricingModel", () => {
    const model = new DynamicPricingModel({
      maximumPriceMultiplier: 2,
    });

    const capped = model.suggestPrice(
      {
        basePriceCents: 1_000,
        urgency: "critical",
        complexity: "expert",
      },
      {
        supplyCount: 1,
        demandCount: 200,
      },
    );

    expect(capped.suggestedPriceCents).toBe(2_000);
  });
});
