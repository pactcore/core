export type DPMechanism = "laplace" | "gaussian" | "exponential";

const EPSILON_FLOOR = 1e-9;
const UINT32_MAX_PLUS_ONE = 4_294_967_296;

export function addNoise(value: number, epsilon: number, mechanism: DPMechanism): number {
  assertFiniteNumber(value, "value");
  assertPositiveNumber(epsilon, "epsilon");

  const safeEpsilon = Math.max(epsilon, EPSILON_FLOOR);
  const seed = `${mechanism}|${value}`;
  const unitA = clampOpenUnitInterval(deterministicUnit(seed));
  const unitB = clampOpenUnitInterval(deterministicUnit(`${seed}|b`));

  let noise = 0;

  switch (mechanism) {
    case "laplace": {
      const scale = 1 / safeEpsilon;
      noise = sampleLaplace(scale, unitA);
      break;
    }
    case "gaussian": {
      const sigma = Math.SQRT2 / safeEpsilon;
      noise = sampleGaussian(sigma, unitA, unitB);
      break;
    }
    case "exponential": {
      const scale = 1 / safeEpsilon;
      noise = sampleSymmetricExponential(scale, unitA, unitB);
      break;
    }
    default: {
      assertNever(mechanism);
    }
  }

  return roundTo(value + noise, 6);
}

export function calculatePrivacyBudget(queryCount: number, epsilonPerQuery: number): number {
  if (!Number.isInteger(queryCount) || queryCount < 0) {
    throw new Error("queryCount must be a non-negative integer");
  }
  if (!Number.isFinite(epsilonPerQuery) || epsilonPerQuery < 0) {
    throw new Error("epsilonPerQuery must be a non-negative number");
  }

  return roundTo(queryCount * epsilonPerQuery, 6);
}

export function compositionTheorem(epsilons: number[]): number {
  if (!Array.isArray(epsilons)) {
    throw new Error("epsilons must be an array");
  }

  let total = 0;
  for (const [index, epsilon] of epsilons.entries()) {
    if (!Number.isFinite(epsilon) || epsilon < 0) {
      throw new Error(`epsilons[${index}] must be a non-negative number`);
    }
    total += epsilon;
  }

  return roundTo(total, 6);
}

function sampleLaplace(scale: number, unit: number): number {
  const centered = unit - 0.5;
  const sign = centered < 0 ? -1 : 1;
  const magnitude = -scale * Math.log(1 - 2 * Math.abs(centered));
  return sign * magnitude;
}

function sampleGaussian(sigma: number, unitA: number, unitB: number): number {
  const radial = Math.sqrt(-2 * Math.log(unitA));
  const angle = 2 * Math.PI * unitB;
  return sigma * radial * Math.cos(angle);
}

function sampleSymmetricExponential(scale: number, unitA: number, unitB: number): number {
  const magnitude = -Math.log(1 - unitA) * scale * 0.5;
  const sign = unitB >= 0.5 ? 1 : -1;
  return sign * magnitude;
}

function deterministicUnit(seed: string): number {
  let hash = 2_166_136_261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return ((hash >>> 0) + 0.5) / UINT32_MAX_PLUS_ONE;
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
}

function assertPositiveNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
}

function clampOpenUnitInterval(value: number): number {
  if (value <= EPSILON_FLOOR) {
    return EPSILON_FLOOR;
  }
  if (value >= 1 - EPSILON_FLOOR) {
    return 1 - EPSILON_FLOOR;
  }
  return value;
}

function roundTo(value: number, decimals: number): number {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function assertNever(value: never): never {
  throw new Error(`unsupported mechanism: ${String(value)}`);
}
