export interface MarketEquilibrium {
  supplyCount: number;
  demandCount: number;
  clearingPriceCents: number;
  matchRate: number;
  surplusWorkers: number;
  surplusTasks: number;
}

export interface SupplyDemandPoint {
  priceCents: number;
  quantity: number;
}

export interface SupplyDemandCurve {
  points: SupplyDemandPoint[];
}

export interface MarketSimulationConfig {
  supplyCurve: SupplyDemandCurve;
  demandCurve: SupplyDemandCurve;
  supplyGrowthRate?: number;
  demandGrowthRate?: number;
  volatility?: number;
  cycleLengthPeriods?: number;
}

export interface MarketWelfare {
  matchedCount: number;
  workerSurplusCents: number;
  taskSurplusCents: number;
  deadweightLossCents: number;
  totalWelfareCents: number;
}

interface NormalizedCurve {
  points: SupplyDemandPoint[];
}

const DEFAULT_CYCLE_LENGTH_PERIODS = 12;
const MIN_DYNAMIC_MULTIPLIER = 0.05;

export function calculateEquilibrium(
  supply: SupplyDemandCurve,
  demand: SupplyDemandCurve,
): MarketEquilibrium {
  const normalizedSupply = normalizeCurve(supply, "supply");
  const normalizedDemand = normalizeCurve(demand, "demand");
  const clearingPrice = findClearingPrice(normalizedSupply, normalizedDemand);

  const supplyCount = Math.max(0, Math.round(interpolateQuantity(normalizedSupply, clearingPrice)));
  const demandCount = Math.max(0, Math.round(interpolateQuantity(normalizedDemand, clearingPrice)));
  const matchedCount = Math.min(supplyCount, demandCount);
  const denominator = Math.max(supplyCount, demandCount);
  const matchRate = denominator === 0 ? 0 : roundTo(matchedCount / denominator, 4);
  const surplusWorkers = Math.max(0, supplyCount - demandCount);
  const surplusTasks = Math.max(0, demandCount - supplyCount);

  return {
    supplyCount,
    demandCount,
    clearingPriceCents: Math.max(0, Math.round(clearingPrice)),
    matchRate,
    surplusWorkers,
    surplusTasks,
  };
}

export function simulateMarketDynamics(
  config: MarketSimulationConfig,
  periods: number,
): MarketEquilibrium[] {
  if (!Number.isInteger(periods) || periods < 0) {
    throw new Error("periods must be a non-negative integer");
  }

  const normalizedSupply = normalizeCurve(config.supplyCurve, "supplyCurve");
  const normalizedDemand = normalizeCurve(config.demandCurve, "demandCurve");
  const supplyGrowthRate = sanitizeGrowthRate(config.supplyGrowthRate ?? 0);
  const demandGrowthRate = sanitizeGrowthRate(config.demandGrowthRate ?? 0);
  const volatility = clamp(config.volatility ?? 0, 0, 0.95);
  const cycleLength = Math.max(2, Math.floor(config.cycleLengthPeriods ?? DEFAULT_CYCLE_LENGTH_PERIODS));

  const snapshots: MarketEquilibrium[] = [];

  for (let period = 0; period < periods; period += 1) {
    const cyclicalSignal =
      volatility === 0 ? 0 : Math.sin((2 * Math.PI * period) / cycleLength) * volatility;
    const supplyMultiplier = Math.max(
      MIN_DYNAMIC_MULTIPLIER,
      Math.pow(1 + supplyGrowthRate, period) * (1 + cyclicalSignal),
    );
    const demandMultiplier = Math.max(
      MIN_DYNAMIC_MULTIPLIER,
      Math.pow(1 + demandGrowthRate, period) * (1 - cyclicalSignal),
    );

    snapshots.push(
      calculateEquilibrium(
        scaleCurve(normalizedSupply, supplyMultiplier),
        scaleCurve(normalizedDemand, demandMultiplier),
      ),
    );
  }

  return snapshots;
}

export function calculateWelfare(equilibrium: MarketEquilibrium): MarketWelfare {
  assertNonNegativeInteger(equilibrium.supplyCount, "supplyCount");
  assertNonNegativeInteger(equilibrium.demandCount, "demandCount");
  assertNonNegativeInteger(equilibrium.clearingPriceCents, "clearingPriceCents");
  if (!Number.isFinite(equilibrium.matchRate) || equilibrium.matchRate < 0 || equilibrium.matchRate > 1) {
    throw new Error("matchRate must be within [0, 1]");
  }
  assertNonNegativeInteger(equilibrium.surplusWorkers, "surplusWorkers");
  assertNonNegativeInteger(equilibrium.surplusTasks, "surplusTasks");

  const matchedCount = Math.min(equilibrium.supplyCount, equilibrium.demandCount);
  const grossTradedValueCents = matchedCount * equilibrium.clearingPriceCents;
  const workerLeverage = equilibrium.demandCount === 0
    ? 0
    : equilibrium.surplusTasks / equilibrium.demandCount;
  const taskLeverage = equilibrium.supplyCount === 0
    ? 0
    : equilibrium.surplusWorkers / equilibrium.supplyCount;

  const workerSurplusRate = 0.1 + Math.min(0.25, workerLeverage * 0.25);
  const taskSurplusRate = 0.1 + Math.min(0.25, taskLeverage * 0.25);

  const workerSurplusCents = Math.round(grossTradedValueCents * workerSurplusRate);
  const taskSurplusCents = Math.round(grossTradedValueCents * taskSurplusRate);
  const deadweightLossCents =
    (equilibrium.surplusWorkers + equilibrium.surplusTasks) * equilibrium.clearingPriceCents;
  const totalWelfareCents = workerSurplusCents + taskSurplusCents - deadweightLossCents;

  return {
    matchedCount,
    workerSurplusCents,
    taskSurplusCents,
    deadweightLossCents,
    totalWelfareCents,
  };
}

function normalizeCurve(curve: SupplyDemandCurve, name: string): NormalizedCurve {
  if (!curve.points.length) {
    throw new Error(`${name} must contain at least one point`);
  }

  const sanitized = curve.points.map((point, index) => {
    if (!Number.isFinite(point.priceCents) || point.priceCents < 0) {
      throw new Error(`${name}.points[${index}].priceCents must be a non-negative number`);
    }
    if (!Number.isFinite(point.quantity) || point.quantity < 0) {
      throw new Error(`${name}.points[${index}].quantity must be a non-negative number`);
    }
    return {
      priceCents: point.priceCents,
      quantity: point.quantity,
    };
  });

  sanitized.sort((a, b) => a.priceCents - b.priceCents);

  const deduplicated: SupplyDemandPoint[] = [];
  for (const point of sanitized) {
    const lastPoint = deduplicated[deduplicated.length - 1];
    if (lastPoint && lastPoint.priceCents === point.priceCents) {
      lastPoint.quantity = point.quantity;
      continue;
    }
    deduplicated.push({ ...point });
  }

  return { points: deduplicated };
}

function scaleCurve(curve: NormalizedCurve, multiplier: number): SupplyDemandCurve {
  return {
    points: curve.points.map((point) => ({
      priceCents: point.priceCents,
      quantity: point.quantity * multiplier,
    })),
  };
}

function findClearingPrice(supply: NormalizedCurve, demand: NormalizedCurve): number {
  const candidates = buildCandidatePrices(supply, demand);
  let bestPrice = candidates[0] ?? 0;
  let smallestAbsoluteExcess = Number.POSITIVE_INFINITY;
  let previousPrice: number | undefined;
  let previousExcess: number | undefined;

  for (const candidate of candidates) {
    const excessDemand = interpolateQuantity(demand, candidate) - interpolateQuantity(supply, candidate);
    const absoluteExcess = Math.abs(excessDemand);

    if (absoluteExcess < smallestAbsoluteExcess) {
      smallestAbsoluteExcess = absoluteExcess;
      bestPrice = candidate;
    }

    if (previousPrice !== undefined && previousExcess !== undefined) {
      if (excessDemand === 0) {
        return candidate;
      }

      if ((previousExcess < 0 && excessDemand > 0) || (previousExcess > 0 && excessDemand < 0)) {
        const span = Math.abs(previousExcess) + Math.abs(excessDemand);
        const weight = span === 0 ? 0.5 : Math.abs(previousExcess) / span;
        return previousPrice + (candidate - previousPrice) * weight;
      }
    }

    previousPrice = candidate;
    previousExcess = excessDemand;
  }

  return bestPrice;
}

function buildCandidatePrices(supply: NormalizedCurve, demand: NormalizedCurve): number[] {
  const unique = new Set<number>();
  for (const point of supply.points) {
    unique.add(point.priceCents);
  }
  for (const point of demand.points) {
    unique.add(point.priceCents);
  }

  const sorted = [...unique].sort((a, b) => a - b);
  const candidates: number[] = [];

  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    if (current === undefined) {
      continue;
    }
    candidates.push(current);

    const next = sorted[index + 1];
    if (next !== undefined && next > current) {
      candidates.push((current + next) / 2);
    }
  }

  return candidates;
}

function interpolateQuantity(curve: NormalizedCurve, priceCents: number): number {
  const points = curve.points;
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];

  if (!firstPoint || !lastPoint) {
    return 0;
  }

  if (priceCents <= firstPoint.priceCents) {
    return firstPoint.quantity;
  }
  if (priceCents >= lastPoint.priceCents) {
    return lastPoint.quantity;
  }

  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1];
    const right = points[index];
    if (!left || !right) {
      continue;
    }
    if (priceCents > right.priceCents) {
      continue;
    }

    const span = right.priceCents - left.priceCents;
    if (span === 0) {
      return right.quantity;
    }
    const position = (priceCents - left.priceCents) / span;
    return left.quantity + (right.quantity - left.quantity) * position;
  }

  return lastPoint.quantity;
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function sanitizeGrowthRate(value: number): number {
  if (!Number.isFinite(value) || value <= -1) {
    throw new Error("growth rates must be finite and greater than -1");
  }
  return value;
}

function roundTo(value: number, decimals: number): number {
  const scale = Math.pow(10, decimals);
  return Math.round(value * scale) / scale;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}
