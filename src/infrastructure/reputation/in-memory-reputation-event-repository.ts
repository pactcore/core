import type { ReputationEventRepository } from "../../application/contracts";
import type { ReputationCategory, ReputationEvent } from "../../domain/reputation-multi";

export class InMemoryReputationEventRepository implements ReputationEventRepository {
  private readonly events: ReputationEvent[] = [];

  async save(event: ReputationEvent): Promise<void> {
    this.events.push(event);
  }

  async getByParticipant(participantId: string, limit?: number): Promise<ReputationEvent[]> {
    const filtered = this.events
      .filter((event) => event.participantId === participantId)
      .sort((left, right) => right.timestamp - left.timestamp);
    return applyLimit(filtered, limit);
  }

  async getByCategory(category: ReputationCategory, limit?: number): Promise<ReputationEvent[]> {
    const filtered = this.events
      .filter((event) => event.category === category)
      .sort((left, right) => right.timestamp - left.timestamp);
    return applyLimit(filtered, limit);
  }
}

function applyLimit(events: ReputationEvent[], limit?: number): ReputationEvent[] {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return events;
  }

  const normalized = Math.max(0, Math.floor(limit));
  return events.slice(0, normalized);
}
