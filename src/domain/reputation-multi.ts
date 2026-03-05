export type ReputationCategory =
  | "task_completion"
  | "verification_accuracy"
  | "payment_reliability"
  | "responsiveness"
  | "skill_expertise";

export type ReputationLevel = "newcomer" | "regular" | "established" | "expert";

export interface ReputationDimension {
  category: ReputationCategory;
  score: number;
  weight: number;
  updatedAt: number;
}

export interface ReputationEvent {
  id: string;
  participantId: string;
  category: ReputationCategory;
  delta: number;
  reason: string;
  timestamp: number;
}

export interface ReputationProfile {
  participantId: string;
  dimensions: ReputationDimension[];
  overallScore: number;
  history: ReputationEvent[];
  level: ReputationLevel;
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const LOG_2 = Math.log(2);

export const reputationCategories: ReputationCategory[] = [
  "task_completion",
  "verification_accuracy",
  "payment_reliability",
  "responsiveness",
  "skill_expertise",
];

export function clampReputationScore(score: number): number {
  if (score < 0) {
    return 0;
  }
  if (score > 100) {
    return 100;
  }
  return Math.round(score * 100) / 100;
}

export function createDefaultDimensions(now = Date.now()): ReputationDimension[] {
  return reputationCategories.map((category) => ({
    category,
    score: 50,
    weight: 1,
    updatedAt: now,
  }));
}

export function calculateOverallScore(dimensions: ReputationDimension[]): number {
  if (dimensions.length === 0) {
    return 50;
  }

  const weighted = dimensions.reduce(
    (acc, dimension) => {
      if (dimension.weight <= 0) {
        return acc;
      }

      return {
        weightedScore: acc.weightedScore + dimension.score * dimension.weight,
        totalWeight: acc.totalWeight + dimension.weight,
      };
    },
    { weightedScore: 0, totalWeight: 0 },
  );

  if (weighted.totalWeight <= 0) {
    return 50;
  }

  return clampReputationScore(weighted.weightedScore / weighted.totalWeight);
}

export function applyTimeDecay(
  dimensions: ReputationDimension[],
  now: number,
  decayHalfLifeDays: number,
): ReputationDimension[] {
  if (decayHalfLifeDays <= 0) {
    return dimensions.map((dimension) => ({ ...dimension }));
  }

  const lambda = LOG_2 / decayHalfLifeDays;

  return dimensions.map((dimension) => {
    const elapsedMs = Math.max(0, now - dimension.updatedAt);
    const elapsedDays = elapsedMs / DAY_MS;
    const decayFactor = Math.exp(-lambda * elapsedDays);
    const nextScore = 50 + (dimension.score - 50) * decayFactor;

    return {
      ...dimension,
      score: clampReputationScore(nextScore),
      updatedAt: now,
    };
  });
}

export function determineReputationLevel(
  overallScore: number,
  totalEvents: number,
): ReputationLevel {
  if (totalEvents <= 0) {
    return "newcomer";
  }

  if (overallScore < 30) {
    return "newcomer";
  }
  if (overallScore < 60) {
    return "regular";
  }
  if (overallScore < 85) {
    return "established";
  }
  return "expert";
}
