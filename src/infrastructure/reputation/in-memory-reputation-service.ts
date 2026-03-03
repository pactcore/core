import type { ReputationRepository, ReputationService } from "../../application/contracts";
import { ReputationModel } from "../../domain/reputation";
import type { ReputationRecord } from "../../domain/types";

export class InMemoryReputationService implements ReputationService {
  private readonly model = new ReputationModel();

  constructor(private readonly repository: ReputationRepository) {}

  async getScore(participantId: string): Promise<number> {
    const record = await this.repository.get(participantId);
    return record?.score ?? 60;
  }

  async setScore(
    participantId: string,
    role: ReputationRecord["role"],
    score: number,
  ): Promise<ReputationRecord> {
    const record: ReputationRecord = {
      participantId,
      role,
      score: this.model.clamp(score),
    };
    await this.repository.save(record);
    return record;
  }

  async adjustScore(
    participantId: string,
    role: ReputationRecord["role"],
    delta: number,
  ): Promise<ReputationRecord> {
    const current = await this.repository.get(participantId);
    const next = current
      ? this.model.applyDelta(current, delta)
      : this.model.initialize({ participantId, role }, 60 + delta);
    await this.repository.save(next);
    return next;
  }
}
