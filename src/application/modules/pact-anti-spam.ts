import type {
  AntiSpamActionRecord,
  AntiSpamRateLimitStore,
  DIDRepository,
  ParticipantStatsRepository,
  ReputationRepository,
} from "../contracts";
import {
  DEFAULT_RATE_LIMITS,
  calculateSpamScore,
  getStakeRequirement,
  type AntiSpamAction,
  type ParticipantSpamStats,
  type RateLimitPolicy,
} from "../../domain/anti-spam";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_REPUTATION = 50;

export interface PactAntiSpamOptions {
  rateLimitStore: AntiSpamRateLimitStore;
  participantStatsRepository?: ParticipantStatsRepository;
  reputationRepository?: ReputationRepository;
  didRepository?: DIDRepository;
  rateLimits?: Partial<Record<AntiSpamAction, RateLimitPolicy>>;
  now?: () => number;
}

export interface ParticipantActionWindow {
  lastHour: number;
  lastDay: number;
  lastActionAt?: number;
}

export interface ParticipantSpamProfile {
  spamScore: number;
  recentActions: Record<AntiSpamAction, ParticipantActionWindow>;
  stakeRequirements: Record<AntiSpamAction, number>;
}

export class PactAntiSpam {
  private readonly now: () => number;
  private readonly rateLimits: Record<AntiSpamAction, RateLimitPolicy>;

  constructor(private readonly options: PactAntiSpamOptions) {
    this.now = options.now ?? Date.now;
    this.rateLimits = {
      task_creation: normalizeRateLimit(options.rateLimits?.task_creation ?? DEFAULT_RATE_LIMITS.task_creation),
      bid_submission: normalizeRateLimit(
        options.rateLimits?.bid_submission ?? DEFAULT_RATE_LIMITS.bid_submission,
      ),
      data_listing: normalizeRateLimit(options.rateLimits?.data_listing ?? DEFAULT_RATE_LIMITS.data_listing),
    };
  }

  async checkRateLimit(
    participantId: string,
    action: AntiSpamAction,
  ): Promise<{ allowed: boolean; retryAfterMs?: number }> {
    const now = this.now();
    const policy = this.rateLimits[action];
    const records = await this.getSortedActionRecords(participantId, action);

    const inLastHour = records.filter((record) => record.occurredAt >= now - HOUR_MS);
    const inLastDay = records.filter((record) => record.occurredAt >= now - DAY_MS);
    const lastActionAt = records.at(-1)?.occurredAt;
    const cooldownRetryMs =
      lastActionAt === undefined ? 0 : Math.max(0, policy.cooldownMs - (now - lastActionAt));
    const hourRetryMs = windowRetryAfterMs(inLastHour, now, HOUR_MS, policy.maxPerHour);
    const dayRetryMs = windowRetryAfterMs(inLastDay, now, DAY_MS, policy.maxPerDay);
    const retryAfterMs = Math.max(cooldownRetryMs, hourRetryMs, dayRetryMs);

    if (retryAfterMs > 0) {
      return {
        allowed: false,
        retryAfterMs,
      };
    }

    return { allowed: true };
  }

  async calculateRequiredStake(
    participantId: string,
    action: AntiSpamAction,
  ): Promise<{ stakeCents: number; spamScore: number }> {
    const stats = await this.buildParticipantSpamStats(participantId);
    const spamScore = calculateSpamScore(stats);
    return {
      stakeCents: getStakeRequirement(action, spamScore),
      spamScore,
    };
  }

  async recordAction(participantId: string, action: AntiSpamAction): Promise<void> {
    const now = this.now();
    const requiredStake = await this.calculateRequiredStake(participantId, action);

    await this.options.rateLimitStore.recordAction({
      participantId,
      action,
      occurredAt: now,
      stakeCents: requiredStake.stakeCents,
    });
  }

  async getParticipantSpamProfile(participantId: string): Promise<ParticipantSpamProfile> {
    const now = this.now();
    const stats = await this.buildParticipantSpamStats(participantId);
    const spamScore = calculateSpamScore(stats);
    const allRecords = await this.getSortedActionRecords(participantId);

    const recentActions: Record<AntiSpamAction, ParticipantActionWindow> = {
      task_creation: buildActionWindow(allRecords, "task_creation", now),
      bid_submission: buildActionWindow(allRecords, "bid_submission", now),
      data_listing: buildActionWindow(allRecords, "data_listing", now),
    };

    const stakeRequirements: Record<AntiSpamAction, number> = {
      task_creation: getStakeRequirement("task_creation", spamScore),
      bid_submission: getStakeRequirement("bid_submission", spamScore),
      data_listing: getStakeRequirement("data_listing", spamScore),
    };

    return {
      spamScore,
      recentActions,
      stakeRequirements,
    };
  }

  private async buildParticipantSpamStats(participantId: string): Promise<ParticipantSpamStats> {
    const now = this.now();
    const participantState = await this.options.rateLimitStore.getParticipantState(participantId);
    const hourStart = now - HOUR_MS;
    const recentActivityPerHour = participantState.actions.filter(
      (action) => action.occurredAt >= hourStart,
    ).length;

    const didDocument = this.options.didRepository
      ? await this.options.didRepository.getByParticipantId(participantId)
      : undefined;
    const accountAgeFromDid =
      didDocument && Number.isFinite(didDocument.createdAt)
        ? Math.max(0, now - didDocument.createdAt)
        : undefined;
    const accountAgeFromFirstSeen =
      participantState.firstSeenAt === undefined ? undefined : Math.max(0, now - participantState.firstSeenAt);
    const accountAgeMs = accountAgeFromDid ?? accountAgeFromFirstSeen ?? 0;

    let reputation = DEFAULT_REPUTATION;
    if (this.options.reputationRepository) {
      const record = await this.options.reputationRepository.get(participantId);
      if (record && Number.isFinite(record.score)) {
        reputation = record.score;
      }
    }

    if (reputation === DEFAULT_REPUTATION && this.options.participantStatsRepository) {
      const stats = await this.options.participantStatsRepository.get(participantId);
      if (stats && Number.isFinite(stats.reputation)) {
        reputation = stats.reputation;
      }
    }

    return {
      accountAgeMs,
      reputation,
      recentActivityPerHour,
      stakeAmountCents: participantState.totalStakeCents,
    };
  }

  private async getSortedActionRecords(
    participantId: string,
    action?: AntiSpamAction,
  ): Promise<AntiSpamActionRecord[]> {
    const records = await this.options.rateLimitStore.listParticipantActions(participantId, action);
    return records.sort((a, b) => a.occurredAt - b.occurredAt);
  }
}

function windowRetryAfterMs(
  records: AntiSpamActionRecord[],
  now: number,
  windowMs: number,
  maxInWindow: number,
): number {
  if (records.length < maxInWindow) {
    return 0;
  }

  const targetIndex = records.length - maxInWindow;
  const target = records[targetIndex];
  if (!target) {
    return 0;
  }
  return Math.max(1, target.occurredAt + windowMs - now);
}

function buildActionWindow(
  allRecords: AntiSpamActionRecord[],
  action: AntiSpamAction,
  now: number,
): ParticipantActionWindow {
  const records = allRecords.filter((record) => record.action === action);
  const lastHour = records.filter((record) => record.occurredAt >= now - HOUR_MS).length;
  const lastDay = records.filter((record) => record.occurredAt >= now - DAY_MS).length;
  return {
    lastHour,
    lastDay,
    lastActionAt: records.at(-1)?.occurredAt,
  };
}

function normalizeRateLimit(policy: RateLimitPolicy): RateLimitPolicy {
  return {
    action: policy.action,
    maxPerHour: Math.max(1, Math.floor(policy.maxPerHour)),
    maxPerDay: Math.max(1, Math.floor(policy.maxPerDay)),
    cooldownMs: Math.max(0, Math.floor(policy.cooldownMs)),
  };
}
