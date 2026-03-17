import { describe, expect, it } from "bun:test";
import type { Task, TaskCategory, TaskConstraints, GeoPoint } from "../src/domain/types";
import {
  isValidTaskCategory,
  validateTaskCategory,
  classifyTask,
  validateTaskCategoryConsistency,
  getTaskCategoryPolicy,
} from "../src/domain/task-classification";

function buildConstraints(overrides: Partial<TaskConstraints> = {}): TaskConstraints {
  return {
    requiredSkills: [],
    maxDistanceKm: 0,
    minReputation: 0,
    capacityRequired: 1,
    ...overrides,
  };
}

function buildTask(overrides: Partial<Task> = {}): Task {
  const now = Date.now();
  return {
    id: "task-1",
    title: "Test task",
    description: "A test task",
    issuerId: "issuer-1",
    paymentCents: 10000,
    category: "digital",
    constraints: buildConstraints(),
    location: { latitude: 0, longitude: 0 },
    status: "Created",
    validatorIds: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("Task classification (§5.1)", () => {
  describe("isValidTaskCategory", () => {
    it("accepts valid categories", () => {
      expect(isValidTaskCategory("physical")).toBe(true);
      expect(isValidTaskCategory("digital")).toBe(true);
      expect(isValidTaskCategory("verification")).toBe(true);
      expect(isValidTaskCategory("micro")).toBe(true);
    });

    it("rejects invalid categories", () => {
      expect(isValidTaskCategory("invalid")).toBe(false);
      expect(isValidTaskCategory("")).toBe(false);
      expect(isValidTaskCategory(null)).toBe(false);
      expect(isValidTaskCategory(undefined)).toBe(false);
      expect(isValidTaskCategory(42)).toBe(false);
    });
  });

  describe("validateTaskCategory", () => {
    it("returns valid categories unchanged", () => {
      expect(validateTaskCategory("physical")).toBe("physical");
      expect(validateTaskCategory("micro")).toBe("micro");
    });

    it("throws for invalid categories", () => {
      expect(() => validateTaskCategory("bogus")).toThrow("Invalid task category");
      expect(() => validateTaskCategory(undefined)).toThrow("Invalid task category");
    });
  });

  describe("classifyTask", () => {
    it("classifies micro tasks by payment and capacity thresholds", () => {
      const result = classifyTask({
        constraints: buildConstraints({ capacityRequired: 1 }),
        paymentCents: 300,
        location: { latitude: 0, longitude: 0 },
      });
      expect(result).toBe("micro");
    });

    it("classifies micro tasks at the boundary (500 cents)", () => {
      const result = classifyTask({
        constraints: buildConstraints({ capacityRequired: 2 }),
        paymentCents: 500,
      });
      expect(result).toBe("micro");
    });

    it("does not classify as micro if payment exceeds threshold", () => {
      const result = classifyTask({
        constraints: buildConstraints({ capacityRequired: 1 }),
        paymentCents: 501,
      });
      expect(result).not.toBe("micro");
    });

    it("does not classify as micro if capacity exceeds threshold", () => {
      const result = classifyTask({
        constraints: buildConstraints({ capacityRequired: 3 }),
        paymentCents: 300,
      });
      expect(result).not.toBe("micro");
    });

    it("classifies verification tasks by skill keywords", () => {
      const verificationSkills = [
        "review",
        "verify",
        "validate",
        "audit",
        "check",
        "inspect",
        "evaluate",
        "assess",
        "moderate",
        "label",
        "annotate",
        "tag",
        "classify",
        "qa",
        "quality",
      ];

      for (const skill of verificationSkills) {
        const result = classifyTask({
          constraints: buildConstraints({ requiredSkills: [skill] }),
          paymentCents: 10000,
        });
        expect(result).toBe("verification");
      }
    });

    it("classifies verification tasks with mixed-case skills", () => {
      const result = classifyTask({
        constraints: buildConstraints({ requiredSkills: ["Code Review", "analysis"] }),
        paymentCents: 5000,
      });
      expect(result).toBe("verification");
    });

    it("classifies physical tasks by location constraints", () => {
      const result = classifyTask({
        constraints: buildConstraints({ maxDistanceKm: 20 }),
        paymentCents: 10000,
        location: { latitude: 37.7749, longitude: -122.4194 },
      });
      expect(result).toBe("physical");
    });

    it("does not classify as physical if location is zero", () => {
      const result = classifyTask({
        constraints: buildConstraints({ maxDistanceKm: 20 }),
        paymentCents: 10000,
        location: { latitude: 0, longitude: 0 },
      });
      expect(result).toBe("digital");
    });

    it("does not classify as physical if maxDistanceKm is 0", () => {
      const result = classifyTask({
        constraints: buildConstraints({ maxDistanceKm: 0 }),
        paymentCents: 10000,
        location: { latitude: 37.7749, longitude: -122.4194 },
      });
      expect(result).toBe("digital");
    });

    it("defaults to digital for tasks without location or verification skills", () => {
      const result = classifyTask({
        constraints: buildConstraints({ requiredSkills: ["python", "data-science"] }),
        paymentCents: 10000,
      });
      expect(result).toBe("digital");
    });

    it("micro takes priority over verification", () => {
      const result = classifyTask({
        constraints: buildConstraints({
          requiredSkills: ["review"],
          capacityRequired: 1,
        }),
        paymentCents: 200,
      });
      expect(result).toBe("micro");
    });

    it("verification takes priority over physical", () => {
      const result = classifyTask({
        constraints: buildConstraints({
          requiredSkills: ["inspect"],
          maxDistanceKm: 10,
        }),
        paymentCents: 5000,
        location: { latitude: 37.7749, longitude: -122.4194 },
      });
      expect(result).toBe("verification");
    });
  });

  describe("validateTaskCategoryConsistency", () => {
    it("returns no errors for consistent physical task", () => {
      const task = buildTask({
        category: "physical",
        constraints: buildConstraints({ maxDistanceKm: 20 }),
        location: { latitude: 37.7749, longitude: -122.4194 },
      });
      expect(validateTaskCategoryConsistency(task)).toEqual([]);
    });

    it("returns errors for physical task with zero maxDistanceKm", () => {
      const task = buildTask({
        category: "physical",
        constraints: buildConstraints({ maxDistanceKm: 0 }),
        location: { latitude: 37.7749, longitude: -122.4194 },
      });
      const errors = validateTaskCategoryConsistency(task);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("maxDistanceKm");
    });

    it("returns errors for physical task with zero location", () => {
      const task = buildTask({
        category: "physical",
        constraints: buildConstraints({ maxDistanceKm: 20 }),
        location: { latitude: 0, longitude: 0 },
      });
      const errors = validateTaskCategoryConsistency(task);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("location");
    });

    it("returns errors for micro task with high payment", () => {
      const task = buildTask({
        category: "micro",
        paymentCents: 10000,
      });
      const errors = validateTaskCategoryConsistency(task);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("500");
    });

    it("returns no errors for valid micro task", () => {
      const task = buildTask({
        category: "micro",
        paymentCents: 200,
      });
      expect(validateTaskCategoryConsistency(task)).toEqual([]);
    });

    it("returns no errors for digital tasks regardless of constraints", () => {
      const task = buildTask({ category: "digital" });
      expect(validateTaskCategoryConsistency(task)).toEqual([]);
    });

    it("returns no errors for verification tasks regardless of constraints", () => {
      const task = buildTask({ category: "verification" });
      expect(validateTaskCategoryConsistency(task)).toEqual([]);
    });

    it("returns errors for invalid category value", () => {
      const task = buildTask({ category: "bogus" as TaskCategory });
      const errors = validateTaskCategoryConsistency(task);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("Invalid");
    });
  });

  describe("getTaskCategoryPolicy", () => {
    it("physical tasks require location and ZK proofs", () => {
      const policy = getTaskCategoryPolicy("physical");
      expect(policy.requiresLocation).toBe(true);
      expect(policy.requiresZKLocationProof).toBe(true);
      expect(policy.autoVerificationEligible).toBe(false);
      expect(policy.maxPaymentCents).toBeNull();
    });

    it("digital tasks are auto-verification eligible", () => {
      const policy = getTaskCategoryPolicy("digital");
      expect(policy.requiresLocation).toBe(false);
      expect(policy.requiresZKLocationProof).toBe(false);
      expect(policy.autoVerificationEligible).toBe(true);
      expect(policy.maxPaymentCents).toBeNull();
    });

    it("verification tasks require minimum 2 validators", () => {
      const policy = getTaskCategoryPolicy("verification");
      expect(policy.minValidatorCount).toBe(2);
      expect(policy.maxValidatorCount).toBe(7);
      expect(policy.autoVerificationEligible).toBe(false);
    });

    it("micro tasks have max payment limit and 0 min validators", () => {
      const policy = getTaskCategoryPolicy("micro");
      expect(policy.minValidatorCount).toBe(0);
      expect(policy.maxValidatorCount).toBe(1);
      expect(policy.autoVerificationEligible).toBe(true);
      expect(policy.maxPaymentCents).toBe(500);
    });

    it("all categories have the correct category field", () => {
      const categories: TaskCategory[] = ["physical", "digital", "verification", "micro"];
      for (const cat of categories) {
        expect(getTaskCategoryPolicy(cat).category).toBe(cat);
      }
    });
  });
});
