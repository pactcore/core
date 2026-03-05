import type { ReputationEventRepository, ReputationProfileRepository } from "../contracts";
import { generateId } from "../utils";
import {
  applyTimeDecay,
  calculateOverallScore,
  clampReputationScore,
  createDefaultDimensions,
  determineReputationLevel,
  type ReputationCategory,
  type ReputationDimension,
  type ReputationEvent,
  type ReputationProfile,
} from "../../domain/reputation-multi";

const DEFAULT_DECAY_HALF_LIFE_DAYS = 30;

export class PactReputation {
  constructor(
    private readonly profileRepository: ReputationProfileRepository,
    private readonly eventRepository: ReputationEventRepository,
  ) {}

  async initializeProfile(participantId: string): Promise<ReputationProfile> {
    const existing = await this.profileRepository.get(participantId);
    if (existing) {
      return this.withDerivedFields(existing);
    }

    const profile = this.buildProfile(participantId, createDefaultDimensions(), []);
    await this.profileRepository.save(profile);
    return profile;
  }

  async recordEvent(
    participantId: string,
    category: ReputationCategory,
    delta: number,
    reason: string,
  ): Promise<ReputationProfile> {
    const profile = await this.initializeProfile(participantId);
    const now = Date.now();
    const dimensions = profile.dimensions.map((dimension) => ({ ...dimension }));
    const dimension = dimensions.find((entry) => entry.category === category);

    if (dimension) {
      dimension.score = clampReputationScore(dimension.score + delta);
      dimension.updatedAt = now;
    } else {
      dimensions.push({
        category,
        score: clampReputationScore(50 + delta),
        weight: 1,
        updatedAt: now,
      });
    }

    const event: ReputationEvent = {
      id: generateId("rep_event"),
      participantId,
      category,
      delta,
      reason,
      timestamp: now,
    };

    await this.eventRepository.save(event);
    const history = [...profile.history, event];
    const nextProfile = this.buildProfile(participantId, dimensions, history);
    await this.profileRepository.save(nextProfile);
    return nextProfile;
  }

  async getProfile(participantId: string): Promise<ReputationProfile> {
    const profile = await this.initializeProfile(participantId);
    const history = await this.eventRepository.getByParticipant(participantId);
    const hydrated = this.buildProfile(participantId, profile.dimensions, history);
    await this.profileRepository.save(hydrated);
    return hydrated;
  }

  async applyDecay(participantId: string): Promise<ReputationProfile> {
    const profile = await this.getProfile(participantId);
    const decayedDimensions = applyTimeDecay(
      profile.dimensions,
      Date.now(),
      DEFAULT_DECAY_HALF_LIFE_DAYS,
    );
    const decayed = this.buildProfile(participantId, decayedDimensions, profile.history);
    await this.profileRepository.save(decayed);
    return decayed;
  }

  async getHistory(participantId: string, limit?: number): Promise<ReputationEvent[]> {
    return this.eventRepository.getByParticipant(participantId, limit);
  }

  async getLeaderboard(category?: ReputationCategory, limit = 10): Promise<ReputationProfile[]> {
    const profiles = await this.profileRepository.list();
    const hydratedProfiles = await Promise.all(
      profiles.map((profile) => this.getProfile(profile.participantId)),
    );

    hydratedProfiles.sort((left, right) => {
      const leftScore = category ? this.getCategoryScore(left.dimensions, category) : left.overallScore;
      const rightScore = category
        ? this.getCategoryScore(right.dimensions, category)
        : right.overallScore;
      return rightScore - leftScore;
    });

    const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 10;
    return hydratedProfiles.slice(0, normalizedLimit);
  }

  private withDerivedFields(profile: ReputationProfile): ReputationProfile {
    return this.buildProfile(profile.participantId, profile.dimensions, profile.history);
  }

  private buildProfile(
    participantId: string,
    dimensions: ReputationDimension[],
    history: ReputationEvent[],
  ): ReputationProfile {
    const sanitizedDimensions = dimensions.map((dimension) => ({
      ...dimension,
      score: clampReputationScore(dimension.score),
    }));
    const overallScore = calculateOverallScore(sanitizedDimensions);

    return {
      participantId,
      dimensions: sanitizedDimensions,
      overallScore,
      history: [...history],
      level: determineReputationLevel(overallScore, history.length),
    };
  }

  private getCategoryScore(
    dimensions: ReputationDimension[],
    category: ReputationCategory,
  ): number {
    return dimensions.find((dimension) => dimension.category === category)?.score ?? 50;
  }
}
