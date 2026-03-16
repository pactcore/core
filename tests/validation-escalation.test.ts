import { describe, expect, it } from "bun:test";
import {
  ThreeLayerValidationPipeline,
  type ValidationConfig,
} from "../src/domain/validation-pipeline";

const fullConfig: ValidationConfig = {
  autoAI: { enabled: true, passThreshold: 0.8 },
  committeeReview: { enabled: true, passThreshold: 0.66, requiredParticipants: 3 },
  humanJury: { enabled: true, passThreshold: 0.6, requiredParticipants: 5 },
};

describe("ValidationPipeline: escalation metadata", () => {
  it("produces no escalations when AutoAI passes", () => {
    const pipeline = new ThreeLayerValidationPipeline(fullConfig);
    const outcome = pipeline.evaluate({ autoAIScore: 0.9, agentVotes: [], humanVotes: [] });

    expect(outcome.passed).toBeTrue();
    expect(outcome.terminalLayer).toBe("AutoAI");
    expect(outcome.escalations).toHaveLength(0);
  });

  it("records AutoAI→CommitteeReview escalation with score and threshold when AutoAI fails", () => {
    const pipeline = new ThreeLayerValidationPipeline(fullConfig);
    const outcome = pipeline.evaluate({
      autoAIScore: 0.5,
      agentVotes: [
        { participantId: "v1", approve: true },
        { participantId: "v2", approve: true },
        { participantId: "v3", approve: true },
      ],
      humanVotes: [],
    });

    expect(outcome.passed).toBeTrue();
    expect(outcome.terminalLayer).toBe("CommitteeReview");
    expect(outcome.escalations).toHaveLength(1);
    expect(outcome.escalations[0].from).toBe("AutoAI");
    expect(outcome.escalations[0].to).toBe("CommitteeReview");
    expect(outcome.escalations[0].reason).toBe("score_below_threshold");
    expect(outcome.escalations[0].score).toBe(0.5);
    expect(outcome.escalations[0].threshold).toBe(0.8);
  });

  it("records both AutoAI→Committee and Committee→HumanJury escalations when committee fails", () => {
    const pipeline = new ThreeLayerValidationPipeline(fullConfig);
    const outcome = pipeline.evaluate({
      autoAIScore: 0.3,
      agentVotes: [
        { participantId: "v1", approve: false },
        { participantId: "v2", approve: false },
        { participantId: "v3", approve: false },
      ],
      humanVotes: [
        { participantId: "j1", approve: true },
        { participantId: "j2", approve: true },
        { participantId: "j3", approve: true },
        { participantId: "j4", approve: true },
        { participantId: "j5", approve: true },
      ],
    });

    expect(outcome.passed).toBeTrue();
    expect(outcome.terminalLayer).toBe("HumanJury");
    expect(outcome.escalations).toHaveLength(2);

    const [first, second] = outcome.escalations;
    expect(first.from).toBe("AutoAI");
    expect(first.to).toBe("CommitteeReview");
    expect(second.from).toBe("CommitteeReview");
    expect(second.to).toBe("HumanJury");
    expect(second.reason).toBe("score_below_threshold");
  });

  it("records Committee→HumanJury as insufficient_votes when votes < requiredParticipants", () => {
    const pipeline = new ThreeLayerValidationPipeline(fullConfig);
    const outcome = pipeline.evaluate({
      autoAIScore: 0.2,
      agentVotes: [
        { participantId: "v1", approve: true },
        // only 1 vote, needs 3
      ],
      humanVotes: [
        { participantId: "j1", approve: true },
        { participantId: "j2", approve: true },
        { participantId: "j3", approve: true },
        { participantId: "j4", approve: true },
        { participantId: "j5", approve: true },
      ],
    });

    expect(outcome.escalations).toHaveLength(2);
    const committeeEscalation = outcome.escalations[1];
    expect(committeeEscalation.reason).toBe("insufficient_votes");
    expect(committeeEscalation.votes).toBe(1);
    expect(committeeEscalation.requiredVotes).toBe(3);
  });

  it("marks CommitteeReview step with escalatedFrom = AutoAI", () => {
    const pipeline = new ThreeLayerValidationPipeline(fullConfig);
    const outcome = pipeline.evaluate({
      autoAIScore: 0.1,
      agentVotes: [
        { participantId: "v1", approve: true },
        { participantId: "v2", approve: true },
        { participantId: "v3", approve: true },
      ],
      humanVotes: [],
    });

    const committeeStep = outcome.steps.find((s) => s.layer === "CommitteeReview");
    expect(committeeStep?.escalatedFrom).toBe("AutoAI");
  });

  it("marks HumanJury step with escalatedFrom = CommitteeReview", () => {
    const pipeline = new ThreeLayerValidationPipeline(fullConfig);
    const outcome = pipeline.evaluate({
      autoAIScore: 0.1,
      agentVotes: [],
      humanVotes: [
        { participantId: "j1", approve: true },
        { participantId: "j2", approve: true },
        { participantId: "j3", approve: true },
        { participantId: "j4", approve: true },
        { participantId: "j5", approve: true },
      ],
    });

    const juryStep = outcome.steps.find((s) => s.layer === "HumanJury");
    expect(juryStep?.escalatedFrom).toBe("CommitteeReview");
  });

  it("records disabled reason when AutoAI is disabled", () => {
    const disabledAutoConfig: ValidationConfig = {
      autoAI: { enabled: false, passThreshold: 0.8 },
      committeeReview: { enabled: true, passThreshold: 0.66, requiredParticipants: 1 },
      humanJury: { enabled: true, passThreshold: 0.6, requiredParticipants: 1 },
    };
    const pipeline = new ThreeLayerValidationPipeline(disabledAutoConfig);
    const outcome = pipeline.evaluate({
      autoAIScore: 0,
      agentVotes: [{ participantId: "v1", approve: true }],
      humanVotes: [],
    });

    expect(outcome.escalations[0].reason).toBe("disabled");
    expect(outcome.escalations[0].from).toBe("AutoAI");
  });

  it("all failure paths still set escalations array (never undefined)", () => {
    const pipeline = new ThreeLayerValidationPipeline(fullConfig);
    const outcome = pipeline.evaluate({
      autoAIScore: 0,
      agentVotes: [],
      humanVotes: [],
    });

    expect(outcome.passed).toBeFalse();
    expect(Array.isArray(outcome.escalations)).toBeTrue();
    expect(outcome.escalations.length).toBeGreaterThan(0);
  });
});
