import { describe, expect, it } from "bun:test";
import { GaleShapleyMatcher } from "../src/domain/matching";
import type { Task, WorkerProfile } from "../src/domain/types";

function createTask(id: string, minReputation = 50): Task {
  const now = Date.now();
  return {
    id,
    title: "Physical check",
    description: "Need local verification",
    issuerId: "issuer-1",
    paymentCents: 20000,
    constraints: {
      requiredSkills: ["photo", "gps"],
      maxDistanceKm: 20,
      minReputation,
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
  reputation: number,
  capacity: number,
  activeTaskIds: string[],
  distanceOffset = 0,
): WorkerProfile {
  return {
    id,
    skills: ["photo", "gps", "courier"],
    reputation,
    location: { latitude: 37.7749 + distanceOffset, longitude: -122.4194 + distanceOffset },
    capacity,
    activeTaskIds,
  };
}

describe("GaleShapleyMatcher", () => {
  it("filters by constraints and assigns feasible workers", () => {
    const matcher = new GaleShapleyMatcher();
    const task = createTask("task-1");

    const workers: WorkerProfile[] = [
      createWorker("worker-good", 90, 2, []),
      createWorker("worker-low-rep", 20, 2, []),
      createWorker("worker-full", 95, 1, ["t-existing"]),
    ];

    const result = matcher.match([task], workers);
    expect(result.assignments.length).toBe(1);
    expect(result.assignments[0]?.workerId).toBe("worker-good");
    expect(result.unmatchedTaskIds).toEqual([]);
  });

  it("returns unmatched tasks when no worker satisfies constraints", () => {
    const matcher = new GaleShapleyMatcher();
    const task = createTask("task-2", 95);

    const workers: WorkerProfile[] = [createWorker("worker-1", 80, 1, [])];

    const result = matcher.match([task], workers);
    expect(result.assignments.length).toBe(0);
    expect(result.unmatchedTaskIds).toEqual(["task-2"]);
  });
});
