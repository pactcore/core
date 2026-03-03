import { describe, expect, it } from "bun:test";
import { IllegalStateTransitionError } from "../src/domain/errors";
import { TaskStateMachine } from "../src/domain/task-state-machine";
import type { Task } from "../src/domain/types";

function createTask(): Task {
  const now = Date.now();
  return {
    id: "task-1",
    title: "Deliver package",
    description: "Deliver to point B",
    issuerId: "issuer-1",
    paymentCents: 10000,
    constraints: {
      requiredSkills: ["delivery"],
      maxDistanceKm: 10,
      minReputation: 50,
      capacityRequired: 1,
    },
    location: {
      latitude: 37.7749,
      longitude: -122.4194,
    },
    status: "Created",
    validatorIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

describe("TaskStateMachine", () => {
  it("supports the required lifecycle transitions", () => {
    const stateMachine = new TaskStateMachine();
    let task = createTask();

    task = stateMachine.transition(task, "Assigned");
    task = stateMachine.transition(task, "Submitted");
    task = stateMachine.transition(task, "Verified");
    task = stateMachine.transition(task, "Completed");

    expect(task.status).toBe("Completed");
  });

  it("throws on illegal transition", () => {
    const stateMachine = new TaskStateMachine();
    const task = createTask();

    expect(() => stateMachine.transition(task, "Submitted")).toThrow(
      IllegalStateTransitionError,
    );
  });
});
