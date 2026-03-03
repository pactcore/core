import type { ReputationRepository } from "../../application/contracts";
import type { ReputationRecord } from "../../domain/types";

export class InMemoryReputationRepository implements ReputationRepository {
  private readonly records = new Map<string, ReputationRecord>();

  async save(record: ReputationRecord): Promise<void> {
    this.records.set(record.participantId, record);
  }

  async get(participantId: string): Promise<ReputationRecord | undefined> {
    return this.records.get(participantId);
  }
}
