import { describe, expect, it } from "bun:test";
import {
  MultiDimensionalMatcher,
  type MatchScore,
  DEFAULT_MATCH_WEIGHTS,
} from "../src/domain/multi-dimensional-matching";
import type { Task, WorkerProfile } from "../src/domain/types";

function createTask(requiredSkills: string[] = ["vision", "gps"]): Task {
  const now = Date.now();
  return {
    id: "task-1",
    title: "Inspect retail shelf",
    description: "Collect and verify evidence",
    issuerId: "issuer-1",
    paymentCents: 10_000,
    constraints: {
      requiredSkills,
      maxDistanceKm: 20,
      minReputation: 0,
      capacityRequired: 1,
    },
    location: { latitude: 37.7749, longitude: -122.4194 },
    status: "Created",
    validatorIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function createWorker(
  id: string,
  overrides: Partial<WorkerProfile> = {},
): WorkerProfile {
  return {
    id,
    skills: ["vision", "gps"],
    reputation: 80,
    location: { latitude: 37.7749, longitude: -122.4194 },
    capacity: 4,
    activeTaskIds: [],
    ...overrides,
  };
}

function weightedTotal(score: MatchScore): number {
  return (
    score.skillScore * DEFAULT_MATCH_WEIGHTS.skillScore +
    score.reputationScore * DEFAULT_MATCH_WEIGHTS.reputationScore +
    score.distanceScore * DEFAULT_MATCH_WEIGHTS.distanceScore +
    score.costScore * DEFAULT_MATCH_WEIGHTS.costScore
  );
}

describe("MultiDimensionalMatcher", () => {
  it("score output includes all dimensions", () => {
    const matcher = new MultiDimensionalMatcher();
    const task = createTask();
    const worker = createWorker("worker-1");

    const score = matcher.scoreMatch(worker, task);
    expect(score.workerId).toBe("worker-1");
    expect(score.taskId).toBe("task-1");
    expect(score.skillScore).toBeGreaterThanOrEqual(0);
    expect(score.reputationScore).toBeGreaterThanOrEqual(0);
    expect(score.distanceScore).toBeGreaterThanOrEqual(0);
    expect(score.costScore).toBeGreaterThanOrEqual(0);
    expect(score.totalScore).toBeCloseTo(weightedTotal(score), 3);
  });

  it("ranks candidates by descending total score", () => {
    const matcher = new MultiDimensionalMatcher();
    const task = createTask();
    const strong = createWorker("strong", {
      reputation: 95,
      activeTaskIds: [],
      location: { latitude: 37.775, longitude: -122.4193 },
    });
    const weak = createWorker("weak", {
      skills: ["vision"],
      reputation: 40,
      activeTaskIds: ["a", "b", "c"],
      location: { latitude: 37.95, longitude: -122.6 },
    });

    const ranking = matcher.rankCandidates([weak, strong], task);
    expect(ranking[0]?.workerId).toBe("strong");
    expect((ranking[0]?.totalScore ?? 0) >= (ranking[1]?.totalScore ?? 0)).toBeTrue();
  });

  it("custom weights can change ranking outcomes", () => {
    const task = createTask(["vision", "gps"]);
    const skillHeavy = createWorker("skill-heavy", {
      skills: ["vision", "gps"],
      reputation: 45,
    });
    const repHeavy = createWorker("rep-heavy", {
      skills: ["vision"],
      reputation: 98,
    });

    const defaultMatcher = new MultiDimensionalMatcher();
    const defaultRank = defaultMatcher.rankCandidates([skillHeavy, repHeavy], task);
    expect(defaultRank[0]?.workerId).toBe("skill-heavy");

    const repWeightedMatcher = new MultiDimensionalMatcher({
      skillScore: 0.1,
      reputationScore: 0.75,
      distanceScore: 0.1,
      costScore: 0.05,
    });
    const repRank = repWeightedMatcher.rankCandidates([skillHeavy, repHeavy], task);
    expect(repRank[0]?.workerId).toBe("rep-heavy");
  });

  it("cost score penalizes workers with saturated capacity", () => {
    const matcher = new MultiDimensionalMatcher();
    const task = createTask();
    const available = createWorker("available", { capacity: 4, activeTaskIds: [] });
    const saturated = createWorker("saturated", { capacity: 4, activeTaskIds: ["a", "b", "c", "d"] });

    const availableScore = matcher.scoreMatch(available, task);
    const saturatedScore = matcher.scoreMatch(saturated, task);
    expect(availableScore.costScore).toBeGreaterThan(saturatedScore.costScore);
  });
});
