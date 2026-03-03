import type { MissionRepository } from "../../application/contracts";
import type { MissionEnvelope } from "../../domain/types";

export class InMemoryMissionRepository implements MissionRepository {
  private readonly missions = new Map<string, MissionEnvelope>();

  async save(mission: MissionEnvelope): Promise<void> {
    this.missions.set(mission.id, mission);
  }

  async getById(id: string): Promise<MissionEnvelope | undefined> {
    return this.missions.get(id);
  }

  async list(): Promise<MissionEnvelope[]> {
    return [...this.missions.values()].sort((a, b) => a.createdAt - b.createdAt);
  }
}
