import { describe, expect, it } from "bun:test";
import {
  ThreeLayerValidationPipeline,
  type ValidationConfig,
} from "../src/domain/validation-pipeline";

const config: ValidationConfig = {
  autoAI: { enabled: true, passThreshold: 0.8 },
  agentValidators: { enabled: true, passThreshold: 0.66, requiredParticipants: 3 },
  humanJury: { enabled: true, passThreshold: 0.6, requiredParticipants: 5 },
};

describe("ThreeLayerValidationPipeline", () => {
  it("passes at auto layer when score is high", () => {
    const pipeline = new ThreeLayerValidationPipeline(config);
    const outcome = pipeline.evaluate({
      autoAIScore: 0.9,
      agentVotes: [],
      humanVotes: [],
    });

    expect(outcome.passed).toBeTrue();
    expect(outcome.terminalLayer).toBe("AutoAI");
  });

  it("falls back to agent validators", () => {
    const pipeline = new ThreeLayerValidationPipeline(config);
    const outcome = pipeline.evaluate({
      autoAIScore: 0.4,
      agentVotes: [
        { participantId: "v1", approve: true },
        { participantId: "v2", approve: true },
        { participantId: "v3", approve: false },
      ],
      humanVotes: [],
    });

    expect(outcome.passed).toBeTrue();
    expect(outcome.terminalLayer).toBe("AgentValidators");
    expect(outcome.validatorIds).toEqual(["v1", "v2", "v3"]);
  });

  it("falls back to human jury when agent validation fails", () => {
    const pipeline = new ThreeLayerValidationPipeline(config);
    const outcome = pipeline.evaluate({
      autoAIScore: 0.2,
      agentVotes: [
        { participantId: "v1", approve: true },
        { participantId: "v2", approve: false },
        { participantId: "v3", approve: false },
      ],
      humanVotes: [
        { participantId: "j1", approve: true },
        { participantId: "j2", approve: true },
        { participantId: "j3", approve: true },
        { participantId: "j4", approve: false },
        { participantId: "j5", approve: true },
      ],
    });

    expect(outcome.passed).toBeTrue();
    expect(outcome.terminalLayer).toBe("HumanJury");
  });
});
