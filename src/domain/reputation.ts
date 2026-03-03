import type { ReputationRecord } from "./types";

export class ReputationModel {
  clamp(score: number): number {
    if (score < 0) {
      return 0;
    }
    if (score > 100) {
      return 100;
    }
    return Math.round(score * 100) / 100;
  }

  initialize(record: Omit<ReputationRecord, "score">, initialScore = 60): ReputationRecord {
    return {
      ...record,
      score: this.clamp(initialScore),
    };
  }

  applyDelta(record: ReputationRecord, delta: number): ReputationRecord {
    return {
      ...record,
      score: this.clamp(record.score + delta),
    };
  }
}
