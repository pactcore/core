import { describe, expect, it } from "bun:test";
import {
  calculateOptimalStrategy,
  simulateVerificationCost,
} from "../src/domain/verification-cost-model";
import {
  calculateNashEquilibrium,
  isStableEquilibrium,
  type NashEquilibriumState,
  type PayoffMatrix,
} from "../src/domain/nash-equilibrium";

describe("verification mechanism cost-accuracy tradeoff", () => {
  it("increases cost as additional verification layers are enabled", () => {
    const autoOnly = simulateVerificationCost("auto-only", 50, 0.25);
    const autoAndAgent = simulateVerificationCost("auto+agent", 50, 0.25);
    const allLayers = simulateVerificationCost("auto+agent+human", 50, 0.25);

    expect(autoOnly.totalCostCents).toBeLessThan(autoAndAgent.totalCostCents);
    expect(autoAndAgent.totalCostCents).toBeLessThan(allLayers.totalCostCents);
  });

  it("improves expected accuracy with deeper verification layers", () => {
    const autoOnly = simulateVerificationCost("auto-only", 50, 0.25);
    const autoAndAgent = simulateVerificationCost("auto+agent", 50, 0.25);
    const allLayers = simulateVerificationCost("auto+agent+human", 50, 0.25);

    expect(autoOnly.estimatedAccuracy).toBeLessThan(autoAndAgent.estimatedAccuracy);
    expect(autoAndAgent.estimatedAccuracy).toBeLessThan(allLayers.estimatedAccuracy);
  });

  it("rejects negative task counts", () => {
    expect(() => simulateVerificationCost("auto-only", -1, 0.2)).toThrow(
      "taskCount must be a non-negative integer",
    );
  });

  it("rejects error rates outside [0, 1]", () => {
    expect(() => simulateVerificationCost("auto-only", 10, 1.1)).toThrow(
      "errorRate must be within [0, 1]",
    );
  });

  it("selects auto-only for modest accuracy targets with tight budgets", () => {
    const strategy = calculateOptimalStrategy(1_000, 0.85);
    expect(strategy).toBe("auto-only");
  });

  it("selects auto+agent for stricter accuracy targets under medium budgets", () => {
    const strategy = calculateOptimalStrategy(5_000, 0.95);
    expect(strategy).toBe("auto+agent");
  });

  it("selects auto+agent+human for near-perfect accuracy targets", () => {
    const strategy = calculateOptimalStrategy(20_000, 0.99);
    expect(strategy).toBe("auto+agent+human");
  });

  it("returns null when budget is insufficient for all viable strategies", () => {
    const strategy = calculateOptimalStrategy(100, 0.8);
    expect(strategy).toBeNull();
  });
});

describe("validator honesty game Nash equilibrium", () => {
  it("finds honest/honest as stable equilibrium when dishonesty is penalized", () => {
    const players = ["validatorA", "validatorB"];
    const strategies = ["honest", "dishonest"];
    const payoffs: PayoffMatrix = {
      "honest|honest": [10, 10],
      "honest|dishonest": [-6, 3],
      "dishonest|honest": [3, -6],
      "dishonest|dishonest": [-8, -8],
    };

    const equilibrium = calculateNashEquilibrium(players, strategies, payoffs);

    expect(equilibrium).toBeDefined();
    expect(equilibrium?.strategyProfile).toEqual({
      validatorA: "honest",
      validatorB: "honest",
    });
    expect(isStableEquilibrium(equilibrium as NashEquilibriumState)).toBeTrue();
  });

  it("returns null when no pure strategy equilibrium exists", () => {
    const equilibrium = calculateNashEquilibrium(
      ["player1", "player2"],
      ["heads", "tails"],
      {
        "heads|heads": [1, -1],
        "heads|tails": [-1, 1],
        "tails|heads": [-1, 1],
        "tails|tails": [1, -1],
      },
    );

    expect(equilibrium).toBeNull();
  });

  it("reports unstable states as non-equilibria", () => {
    const unstableState: NashEquilibriumState = {
      players: ["validatorA", "validatorB"],
      strategyProfile: { validatorA: "honest", validatorB: "dishonest" },
      payoffByPlayer: { validatorA: -6, validatorB: 3 },
      totalPayoff: -3,
      profitableDeviations: ["validatorA:honest->dishonest"],
      stable: false,
    };

    expect(isStableEquilibrium(unstableState)).toBeFalse();
  });

  it("throws when payoff matrix is missing a strategy profile", () => {
    expect(() =>
      calculateNashEquilibrium(
        ["validatorA", "validatorB"],
        ["honest", "dishonest"],
        {
          "honest|honest": [10, 10],
        },
      )).toThrow('missing payoff vector for strategy profile');
  });
});
