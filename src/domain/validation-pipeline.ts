import { ValidationFailedError } from "./errors";
import type { ValidationEvidence } from "./types";

export type ValidationLayer = "AutoAI" | "AgentValidators" | "HumanJury";

export interface AutoAILayerConfig {
  enabled: boolean;
  passThreshold: number;
}

export interface VotingLayerConfig {
  enabled: boolean;
  passThreshold: number;
  requiredParticipants: number;
}

export interface ValidationConfig {
  autoAI: AutoAILayerConfig;
  agentValidators: VotingLayerConfig;
  humanJury: VotingLayerConfig;
}

export interface ValidationStepResult {
  layer: ValidationLayer;
  executed: boolean;
  passed: boolean;
  score: number;
  votes: number;
}

export interface ValidationOutcome {
  passed: boolean;
  terminalLayer: ValidationLayer | null;
  steps: ValidationStepResult[];
  validatorIds: string[];
  reason?: string;
}

function computeVoteScore(votes: ValidationEvidence["agentVotes"] | ValidationEvidence["humanVotes"]): number {
  if (votes.length === 0) {
    return 0;
  }

  const approvals = votes.filter((vote) => vote.approve).length;
  return approvals / votes.length;
}

export class ThreeLayerValidationPipeline {
  constructor(private readonly config: ValidationConfig) {}

  evaluate(evidence: ValidationEvidence): ValidationOutcome {
    const steps: ValidationStepResult[] = [];

    const autoStep: ValidationStepResult = {
      layer: "AutoAI",
      executed: this.config.autoAI.enabled,
      passed: false,
      score: evidence.autoAIScore,
      votes: 0,
    };

    if (this.config.autoAI.enabled) {
      autoStep.passed = evidence.autoAIScore >= this.config.autoAI.passThreshold;
    }

    steps.push(autoStep);

    if (autoStep.executed && autoStep.passed) {
      return {
        passed: true,
        terminalLayer: "AutoAI",
        steps,
        validatorIds: [],
      };
    }

    const agentStep = this.evaluateVotingLayer(
      "AgentValidators",
      evidence.agentVotes,
      this.config.agentValidators,
    );
    steps.push(agentStep);

    if (agentStep.executed && agentStep.passed) {
      return {
        passed: true,
        terminalLayer: "AgentValidators",
        steps,
        validatorIds: evidence.agentVotes.map((vote) => vote.participantId),
      };
    }

    const humanStep = this.evaluateVotingLayer(
      "HumanJury",
      evidence.humanVotes,
      this.config.humanJury,
    );
    steps.push(humanStep);

    if (humanStep.executed && humanStep.passed) {
      return {
        passed: true,
        terminalLayer: "HumanJury",
        steps,
        validatorIds: evidence.humanVotes.map((vote) => vote.participantId),
      };
    }

    const reason = "Validation pipeline failed to meet the configured thresholds.";
    return {
      passed: false,
      terminalLayer: humanStep.executed ? "HumanJury" : agentStep.executed ? "AgentValidators" : null,
      steps,
      validatorIds: [],
      reason,
    };
  }

  assertPassed(evidence: ValidationEvidence): ValidationOutcome {
    const outcome = this.evaluate(evidence);
    if (!outcome.passed) {
      throw new ValidationFailedError(outcome.reason ?? "Validation failed");
    }
    return outcome;
  }

  private evaluateVotingLayer(
    layer: ValidationLayer,
    votes: ValidationEvidence["agentVotes"] | ValidationEvidence["humanVotes"],
    config: VotingLayerConfig,
  ): ValidationStepResult {
    if (!config.enabled) {
      return {
        layer,
        executed: false,
        passed: false,
        score: 0,
        votes: votes.length,
      };
    }

    if (votes.length < config.requiredParticipants) {
      return {
        layer,
        executed: true,
        passed: false,
        score: computeVoteScore(votes),
        votes: votes.length,
      };
    }

    const score = computeVoteScore(votes);
    return {
      layer,
      executed: true,
      passed: score >= config.passThreshold,
      score,
      votes: votes.length,
    };
  }
}

export const recommendedValidationConfig: ValidationConfig = {
  autoAI: {
    enabled: true,
    passThreshold: 0.8,
  },
  agentValidators: {
    enabled: true,
    passThreshold: 0.75,
    requiredParticipants: 3,
  },
  humanJury: {
    enabled: true,
    passThreshold: 0.66,
    requiredParticipants: 5,
  },
};
