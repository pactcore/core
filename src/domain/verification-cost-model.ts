export type VerificationStrategy = "auto-only" | "auto+agent" | "auto+agent+human";

export interface CostAccuracyTradeoff {
  strategy: VerificationStrategy;
  taskCount: number;
  errorRate: number;
  estimatedAccuracy: number;
  estimatedErrorRate: number;
  estimatedFailedTasks: number;
  totalCostCents: number;
  costPerTaskCents: number;
  totalLatencySeconds: number;
  latencyPerTaskSeconds: number;
}

interface VerificationLayerModel {
  costPerTaskCents: number;
  latencyPerTaskSeconds: number;
  errorCaptureRate: number;
}

const OPTIMIZATION_TASK_COUNT = 100;
const OPTIMIZATION_ERROR_RATE = 0.2;

const LAYER_MODELS: Record<"auto" | "agent" | "human", VerificationLayerModel> = {
  auto: {
    costPerTaskCents: 2,
    latencyPerTaskSeconds: 0.2,
    errorCaptureRate: 0.4,
  },
  agent: {
    costPerTaskCents: 18,
    latencyPerTaskSeconds: 8,
    errorCaptureRate: 0.65,
  },
  human: {
    costPerTaskCents: 120,
    latencyPerTaskSeconds: 120,
    errorCaptureRate: 0.9,
  },
};

const STRATEGY_LAYERS: Record<VerificationStrategy, Array<keyof typeof LAYER_MODELS>> = {
  "auto-only": ["auto"],
  "auto+agent": ["auto", "agent"],
  "auto+agent+human": ["auto", "agent", "human"],
};

const STRATEGY_ORDER: VerificationStrategy[] = [
  "auto-only",
  "auto+agent",
  "auto+agent+human",
];

export function simulateVerificationCost(
  strategy: VerificationStrategy,
  taskCount: number,
  errorRate: number,
): CostAccuracyTradeoff {
  assertTaskCount(taskCount);
  assertRate(errorRate, "errorRate");

  const layers = STRATEGY_LAYERS[strategy];
  let residualError = errorRate;
  let costPerTaskCents = 0;
  let latencyPerTaskSeconds = 0;

  for (const layer of layers) {
    const model = LAYER_MODELS[layer];
    residualError *= 1 - model.errorCaptureRate;
    costPerTaskCents += model.costPerTaskCents;
    latencyPerTaskSeconds += model.latencyPerTaskSeconds;
  }

  const estimatedErrorRate = roundTo(clamp01(residualError), 4);
  const estimatedAccuracy = roundTo(1 - estimatedErrorRate, 4);
  const totalCostCents = Math.round(costPerTaskCents * taskCount);
  const totalLatencySeconds = roundTo(latencyPerTaskSeconds * taskCount, 2);
  const estimatedFailedTasks = Math.round(estimatedErrorRate * taskCount);

  return {
    strategy,
    taskCount,
    errorRate,
    estimatedAccuracy,
    estimatedErrorRate,
    estimatedFailedTasks,
    totalCostCents,
    costPerTaskCents,
    totalLatencySeconds,
    latencyPerTaskSeconds: roundTo(latencyPerTaskSeconds, 2),
  };
}

export function calculateOptimalStrategy(
  budget: number,
  requiredAccuracy: number,
): VerificationStrategy | null {
  if (!Number.isFinite(budget) || budget < 0) {
    throw new Error("budget must be a non-negative number");
  }
  assertRate(requiredAccuracy, "requiredAccuracy");

  const candidates = STRATEGY_ORDER
    .map((strategy) => simulateVerificationCost(strategy, OPTIMIZATION_TASK_COUNT, OPTIMIZATION_ERROR_RATE))
    .filter(
      (tradeoff) =>
        tradeoff.totalCostCents <= budget && tradeoff.estimatedAccuracy >= requiredAccuracy,
    );

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    if (left.totalCostCents !== right.totalCostCents) {
      return left.totalCostCents - right.totalCostCents;
    }
    if (left.estimatedAccuracy !== right.estimatedAccuracy) {
      return right.estimatedAccuracy - left.estimatedAccuracy;
    }
    return STRATEGY_ORDER.indexOf(left.strategy) - STRATEGY_ORDER.indexOf(right.strategy);
  });

  return candidates[0]?.strategy ?? null;
}

function assertTaskCount(taskCount: number): void {
  if (!Number.isInteger(taskCount) || taskCount < 0) {
    throw new Error("taskCount must be a non-negative integer");
  }
}

function assertRate(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be within [0, 1]`);
  }
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

function roundTo(value: number, decimals: number): number {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}
