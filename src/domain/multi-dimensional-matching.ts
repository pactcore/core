import type { Task, WorkerProfile } from "./types";

export interface MatchScore {
  workerId: string;
  taskId: string;
  skillScore: number;
  reputationScore: number;
  distanceScore: number;
  costScore: number;
  totalScore: number;
}

export interface MatchWeights {
  skillScore: number;
  reputationScore: number;
  distanceScore: number;
  costScore: number;
}

export const DEFAULT_MATCH_WEIGHTS: MatchWeights = {
  skillScore: 0.4,
  reputationScore: 0.3,
  distanceScore: 0.2,
  costScore: 0.1,
};

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const earthRadiusKm = 6371;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function normalizeWeights(weights: MatchWeights): MatchWeights {
  const sum = weights.skillScore + weights.reputationScore + weights.distanceScore + weights.costScore;
  if (!Number.isFinite(sum) || sum <= 0) {
    throw new Error("match weights must sum to a positive number");
  }

  return {
    skillScore: weights.skillScore / sum,
    reputationScore: weights.reputationScore / sum,
    distanceScore: weights.distanceScore / sum,
    costScore: weights.costScore / sum,
  };
}

export class MultiDimensionalMatcher {
  private readonly baseWeights: MatchWeights;

  constructor(weights: Partial<MatchWeights> = {}) {
    this.baseWeights = normalizeWeights({
      ...DEFAULT_MATCH_WEIGHTS,
      ...weights,
    });
  }

  scoreMatch(worker: WorkerProfile, task: Task, weights?: Partial<MatchWeights>): MatchScore {
    const appliedWeights = normalizeWeights({
      ...this.baseWeights,
      ...weights,
    });

    const skillScore = this.calculateSkillScore(worker, task);
    const reputationScore = clamp01(worker.reputation / 100);
    const distanceScore = this.calculateDistanceScore(worker, task);
    const costScore = this.calculateCostScore(worker);

    const totalScore = round4(
      skillScore * appliedWeights.skillScore +
        reputationScore * appliedWeights.reputationScore +
        distanceScore * appliedWeights.distanceScore +
        costScore * appliedWeights.costScore,
    );

    return {
      workerId: worker.id,
      taskId: task.id,
      skillScore: round4(skillScore),
      reputationScore: round4(reputationScore),
      distanceScore: round4(distanceScore),
      costScore: round4(costScore),
      totalScore,
    };
  }

  rankCandidates(workers: WorkerProfile[], task: Task): MatchScore[] {
    return workers
      .map((worker) => this.scoreMatch(worker, task))
      .sort((a, b) => {
        if (b.totalScore !== a.totalScore) {
          return b.totalScore - a.totalScore;
        }
        if (b.reputationScore !== a.reputationScore) {
          return b.reputationScore - a.reputationScore;
        }
        return a.workerId.localeCompare(b.workerId);
      });
  }

  private calculateSkillScore(worker: WorkerProfile, task: Task): number {
    const required = task.constraints.requiredSkills;
    if (required.length === 0) {
      return 1;
    }

    const matched = required.filter((skill) => worker.skills.includes(skill)).length;
    return clamp01(matched / required.length);
  }

  private calculateDistanceScore(worker: WorkerProfile, task: Task): number {
    const maxDistanceKm = Math.max(task.constraints.maxDistanceKm, 1);
    const distance = distanceKm(worker.location, task.location);
    return clamp01(1 - distance / maxDistanceKm);
  }

  private calculateCostScore(worker: WorkerProfile): number {
    if (worker.capacity <= 0) {
      return 0;
    }

    const availableCapacity = Math.max(0, worker.capacity - worker.activeTaskIds.length);
    return clamp01(availableCapacity / worker.capacity);
  }
}
