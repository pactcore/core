import type { ParticipantRepository } from "../../application/contracts";
import type { Participant } from "../../domain/types";

export class InMemoryParticipantRepository implements ParticipantRepository {
  private readonly participants = new Map<string, Participant>();

  async save(participant: Participant): Promise<void> {
    this.participants.set(participant.id, participant);
  }

  async getById(id: string): Promise<Participant | undefined> {
    return this.participants.get(id);
  }

  async listByRole(role: Participant["role"]): Promise<Participant[]> {
    return [...this.participants.values()].filter((participant) => participant.role === role);
  }
}
