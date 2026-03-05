export type AutonomyLevel = 1 | 2 | 3 | 4 | 5;

export interface AutonomyMetrics {
  decisionAccuracy: number;
  taskCompletionRate: number;
  errorRecoveryRate: number;
  humanInterventionRate: number;
}

export interface AgentCapabilityHistoryEntry {
  participantId: string;
  decisionAccurate?: boolean;
  completed?: boolean;
  encounteredError?: boolean;
  recoveredFromError?: boolean;
  humanInterventionRequired?: boolean;
}

export function calculateAutonomyLevel(metrics: AutonomyMetrics): AutonomyLevel {
  const normalized = normalizeMetrics(metrics);
  const compositeScore =
    normalized.decisionAccuracy * 0.35 +
    normalized.taskCompletionRate * 0.35 +
    normalized.errorRecoveryRate * 0.2 +
    (100 - normalized.humanInterventionRate) * 0.1;

  if (compositeScore < 40) {
    return 1;
  }
  if (compositeScore < 55) {
    return 2;
  }
  if (compositeScore < 70) {
    return 3;
  }
  if (compositeScore < 85) {
    return 4;
  }
  return 5;
}

export function assessAgentCapability(
  participantId: string,
  history: AgentCapabilityHistoryEntry[],
): AutonomyMetrics {
  const scopedHistory = history.filter((entry) => entry.participantId === participantId);
  if (scopedHistory.length === 0) {
    return {
      decisionAccuracy: 0,
      taskCompletionRate: 0,
      errorRecoveryRate: 0,
      humanInterventionRate: 0,
    };
  }

  const decisionCount = scopedHistory.filter((entry) => typeof entry.decisionAccurate === "boolean")
    .length;
  const accurateDecisionCount = scopedHistory.filter((entry) => entry.decisionAccurate === true).length;
  const completedCount = scopedHistory.filter((entry) => entry.completed === true).length;
  const interventionCount = scopedHistory.filter(
    (entry) => entry.humanInterventionRequired === true,
  ).length;
  const errorEvents = scopedHistory.filter(
    (entry) => entry.encounteredError === true || entry.completed === false,
  );
  const recoveredEvents = errorEvents.filter((entry) => entry.recoveredFromError === true).length;

  return normalizeMetrics({
    decisionAccuracy:
      decisionCount === 0 ? 0 : (accurateDecisionCount / decisionCount) * 100,
    taskCompletionRate: (completedCount / scopedHistory.length) * 100,
    errorRecoveryRate:
      errorEvents.length === 0 ? 100 : (recoveredEvents / errorEvents.length) * 100,
    humanInterventionRate: (interventionCount / scopedHistory.length) * 100,
  });
}

function normalizeMetrics(metrics: AutonomyMetrics): AutonomyMetrics {
  return {
    decisionAccuracy: round2(clampPercent(metrics.decisionAccuracy)),
    taskCompletionRate: round2(clampPercent(metrics.taskCompletionRate)),
    errorRecoveryRate: round2(clampPercent(metrics.errorRecoveryRate)),
    humanInterventionRate: round2(clampPercent(metrics.humanInterventionRate)),
  };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
