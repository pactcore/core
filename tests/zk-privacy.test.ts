import { describe, expect, it } from "bun:test";
import {
  addNoise,
  calculatePrivacyBudget,
  compositionTheorem,
} from "../src/domain/differential-privacy";
import {
  calculatePrivacyScore,
  measureInformationLeakage,
  runPrivacyExperiment,
} from "../src/domain/zk-privacy-experiment";

const PUBLIC_INPUTS = {
  participantId: "worker-7",
  minScore: 80,
  region: "us-west",
};

const LEAKY_PROOF = {
  privacyLevel: "none" as const,
  participantId: "worker-7",
  minScore: 80,
  region: "us-west",
  witness: "raw_secret_nonce",
  statement: "transparent",
};

const REDACTED_PROOF = {
  privacyLevel: "full" as const,
  commitment: "0xabc123",
  transcript: "zero-knowledge commitment hash redacted",
};

describe("zk privacy leakage scoring", () => {
  it("returns a leakage value bounded to [0, 1]", () => {
    const leakage = measureInformationLeakage(LEAKY_PROOF, PUBLIC_INPUTS);
    expect(leakage).toBeGreaterThanOrEqual(0);
    expect(leakage).toBeLessThanOrEqual(1);
  });

  it("scores leaky proofs higher than redacted proofs", () => {
    const leaky = measureInformationLeakage(LEAKY_PROOF, PUBLIC_INPUTS);
    const redacted = measureInformationLeakage(REDACTED_PROOF, PUBLIC_INPUTS);
    expect(leaky).toBeGreaterThan(redacted);
  });

  it("maps leakage to [0, 100] privacy score with clamping", () => {
    expect(calculatePrivacyScore(0)).toBe(100);
    expect(calculatePrivacyScore(1)).toBe(0);
    expect(calculatePrivacyScore(-0.2)).toBe(100);
    expect(calculatePrivacyScore(3)).toBe(0);
  });
});

describe("zk privacy experiment simulation", () => {
  it("evaluates all settings and emits generated IDs with expected prefixes", () => {
    const result = runPrivacyExperiment({
      publicInputs: PUBLIC_INPUTS,
      baselineUtilityScore: 95,
      proofSettings: [
        {
          id: "setting-none",
          name: "No Shielding",
          privacyLevel: "none",
          proof: LEAKY_PROOF,
          utilityRetention: 1,
          verificationOverhead: 0.01,
        },
        {
          id: "setting-partial",
          name: "Selective Disclosure",
          privacyLevel: "partial",
          proof: {
            privacyLevel: "partial",
            commitment: "0xpartial",
            region: "us-west",
            metadata: "masked participant data",
          },
          utilityRetention: 0.95,
          verificationOverhead: 0.06,
        },
        {
          name: "Full Shield",
          privacyLevel: "full",
          proof: REDACTED_PROOF,
          utilityRetention: 0.82,
          verificationOverhead: 0.16,
        },
      ],
    });

    expect(result.settingsEvaluated).toBe(3);
    expect(result.observations).toHaveLength(3);
    expect(result.id.startsWith("zk_privacy_experiment_")).toBeTrue();

    const fullShield = result.observations.find((entry) => entry.settingName === "Full Shield");
    expect(fullShield).toBeDefined();
    expect(fullShield?.settingId.startsWith("zk_privacy_setting_")).toBeTrue();
    expect(fullShield?.id.startsWith("zk_privacy_observation_")).toBeTrue();
  });

  it("captures privacy-vs-utility tradeoff across levels", () => {
    const result = runPrivacyExperiment({
      publicInputs: PUBLIC_INPUTS,
      proofSettings: [
        { name: "none", privacyLevel: "none", proof: LEAKY_PROOF },
        {
          name: "partial",
          privacyLevel: "partial",
          proof: {
            privacyLevel: "partial",
            commitment: "0xpartial",
            region: "us-west",
          },
        },
        { name: "full", privacyLevel: "full", proof: REDACTED_PROOF },
      ],
    });

    const none = result.observations.find((entry) => entry.privacyLevel === "none");
    const full = result.observations.find((entry) => entry.privacyLevel === "full");

    expect(none).toBeDefined();
    expect(full).toBeDefined();
    expect((none?.utilityScore ?? 0) > (full?.utilityScore ?? 0)).toBeTrue();
    expect((full?.privacyScore ?? 0) > (none?.privacyScore ?? 0)).toBeTrue();
  });

  it("marks the setting with the highest tradeoff score as best", () => {
    const result = runPrivacyExperiment({
      publicInputs: PUBLIC_INPUTS,
      proofSettings: [
        { id: "a", name: "A", privacyLevel: "none", proof: LEAKY_PROOF },
        {
          id: "b",
          name: "B",
          privacyLevel: "partial",
          proof: { privacyLevel: "partial", commitment: "0x1", region: "us-west" },
        },
        { id: "c", name: "C", privacyLevel: "full", proof: REDACTED_PROOF },
      ],
    });

    const best = result.observations.reduce((currentBest, candidate) => {
      if (!currentBest || candidate.tradeoffScore > currentBest.tradeoffScore) {
        return candidate;
      }
      return currentBest;
    }, result.observations[0]);

    expect(best).toBeDefined();
    expect(result.bestSettingId).toBe(best?.settingId ?? null);
    expect(result.bestSettingName).toBe(best?.settingName ?? null);
  });

  it("rejects empty experiment settings", () => {
    expect(() =>
      runPrivacyExperiment({
        publicInputs: PUBLIC_INPUTS,
        proofSettings: [],
      })).toThrow("proofSettings must contain at least one setting");
  });
});

describe("differential privacy helpers", () => {
  it("addNoise is deterministic for identical inputs", () => {
    expect(addNoise(100, 0.8, "laplace")).toBe(addNoise(100, 0.8, "laplace"));
    expect(addNoise(100, 0.8, "gaussian")).toBe(addNoise(100, 0.8, "gaussian"));
    expect(addNoise(100, 0.8, "exponential")).toBe(addNoise(100, 0.8, "exponential"));
  });

  it("higher epsilon reduces noise magnitude for gaussian mechanism", () => {
    const lowEpsilon = addNoise(50, 0.2, "gaussian");
    const highEpsilon = addNoise(50, 2, "gaussian");

    expect(Math.abs(lowEpsilon - 50)).toBeGreaterThan(Math.abs(highEpsilon - 50));
  });

  it("computes privacy budget as linear query composition", () => {
    expect(calculatePrivacyBudget(12, 0.15)).toBe(1.8);
  });

  it("applies basic sequential composition theorem", () => {
    expect(compositionTheorem([0.1, 0.2, 0.3, 0.4])).toBe(1);
  });
});
