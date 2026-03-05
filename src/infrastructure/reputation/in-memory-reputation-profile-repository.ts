import type { ReputationProfileRepository } from "../../application/contracts";
import type { ReputationProfile } from "../../domain/reputation-multi";

export class InMemoryReputationProfileRepository implements ReputationProfileRepository {
  private readonly profiles = new Map<string, ReputationProfile>();

  async save(profile: ReputationProfile): Promise<void> {
    this.profiles.set(profile.participantId, profile);
  }

  async get(participantId: string): Promise<ReputationProfile | undefined> {
    return this.profiles.get(participantId);
  }

  async list(): Promise<ReputationProfile[]> {
    return [...this.profiles.values()];
  }
}
