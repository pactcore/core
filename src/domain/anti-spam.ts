const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type AntiSpamAction = "task_creation" | "bid_submission" | "data_listing";

export interface StakeRequirement {
  action: AntiSpamAction;
  baseStakeCents: number;
  maxStakeCents: number;
}

export interface SpamScoreModel {
  accountAgeWeight: number;
  reputationWeight: number;
  recentActivityWeight: number;
  stakeWeight: number;
  matureAccountAgeMs: number;
  highActivityPerHour: number;
  trustedStakeCents: number;
}

export interface RateLimitPolicy {
  action: AntiSpamAction;
  maxPerHour: number;
  maxPerDay: number;
  cooldownMs: number;
}

export interface ParticipantSpamStats {
  accountAgeMs: number;
  reputation: number;
  recentActivityPerHour: number;
  stakeAmountCents: number;
}

export const DEFAULT_SPAM_SCORE_MODEL: SpamScoreModel = {
  accountAgeWeight: 0.3,
  reputationWeight: 0.3,
  recentActivityWeight: 0.25,
  stakeWeight: 0.15,
  matureAccountAgeMs: 90 * DAY_MS,
  highActivityPerHour: 20,
  trustedStakeCents: 5_000,
};

export const DEFAULT_STAKE_REQUIREMENTS: Record<AntiSpamAction, StakeRequirement> = {
  task_creation: {
    action: "task_creation",
    baseStakeCents: 500,
    maxStakeCents: 6_000,
  },
  bid_submission: {
    action: "bid_submission",
    baseStakeCents: 100,
    maxStakeCents: 1_500,
  },
  data_listing: {
    action: "data_listing",
    baseStakeCents: 300,
    maxStakeCents: 4_000,
  },
};

export const DEFAULT_RATE_LIMITS: Record<AntiSpamAction, RateLimitPolicy> = {
  task_creation: {
    action: "task_creation",
    maxPerHour: 12,
    maxPerDay: 48,
    cooldownMs: 45_000,
  },
  bid_submission: {
    action: "bid_submission",
    maxPerHour: 30,
    maxPerDay: 180,
    cooldownMs: 5_000,
  },
  data_listing: {
    action: "data_listing",
    maxPerHour: 8,
    maxPerDay: 24,
    cooldownMs: 90_000,
  },
};

export function calculateSpamScore(
  stats: ParticipantSpamStats,
  model: SpamScoreModel = DEFAULT_SPAM_SCORE_MODEL,
): number {
  const accountAgeRisk = 100 * (1 - clamp01(stats.accountAgeMs / model.matureAccountAgeMs));
  const reputationRisk = 100 - clamp(stats.reputation, 0, 100);
  const activityRisk = 100 * clamp01(stats.recentActivityPerHour / model.highActivityPerHour);
  const stakeRisk = 100 * (1 - clamp01(stats.stakeAmountCents / model.trustedStakeCents));

  const weighted =
    accountAgeRisk * model.accountAgeWeight +
    reputationRisk * model.reputationWeight +
    activityRisk * model.recentActivityWeight +
    stakeRisk * model.stakeWeight;

  return clamp(Math.round(weighted), 0, 100);
}

export function getStakeRequirement(
  action: AntiSpamAction,
  spamScore: number,
  requirements: Record<AntiSpamAction, StakeRequirement> = DEFAULT_STAKE_REQUIREMENTS,
): number {
  const policy = requirements[action];
  const normalizedScore = clamp(spamScore, 0, 100) / 100;
  const multiplier = 1 + normalizedScore * normalizedScore * 4;
  const required = Math.round(policy.baseStakeCents * multiplier);
  return clamp(required, policy.baseStakeCents, policy.maxStakeCents);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
