import type { ValidatorConsensus } from "../../application/contracts";
import type { TaskEvidence } from "../../domain/types";
import {
  ThreeLayerValidationPipeline,
  type ValidationConfig,
  type ValidationOutcome,
} from "../../domain/validation-pipeline";

export class InMemoryValidatorConsensus implements ValidatorConsensus {
  private readonly pipeline: ThreeLayerValidationPipeline;

  constructor(config: ValidationConfig) {
    this.pipeline = new ThreeLayerValidationPipeline(config);
  }

  async evaluate(evidence: TaskEvidence): Promise<ValidationOutcome> {
    return this.pipeline.evaluate(evidence.validation);
  }
}
