import type { ParticipantStatsRepository } from "../../application/contracts";
import type { ParticipantStats } from "../../domain/types";

export class InMemoryParticipantStatsRepository implements ParticipantStatsRepository {
  private readonly statsByParticipantId = new Map<string, ParticipantStats>();

  async save(stats: ParticipantStats): Promise<void> {
    this.statsByParticipantId.set(stats.participantId, stats);
  }

  async get(participantId: string): Promise<ParticipantStats | undefined> {
    return this.statsByParticipantId.get(participantId);
  }
}
