export type PactApplication = "tasks" | "pay" | "id" | "data" | "compute" | "dev" | "ecosystem";

export interface PactToken {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: number;
  launchTimestamp: number;
}

export interface TokenDistribution {
  application: PactApplication;
  allocationPercent: number;
  allocationAmount: number;
  initialUnlockPercent: number;
  description?: string;
}

export interface VestingSchedule {
  application: PactApplication;
  cliffMonths: number;
  vestingMonths: number;
  startTimestamp: number;
}

export interface TokenomicsModel {
  token: PactToken;
  distribution: TokenDistribution[];
  vestingSchedules: VestingSchedule[];
}

export interface TokenSupplyProjection {
  month: number;
  timestamp: number;
  circulatingSupply: number;
  lockedSupply: number;
  totalSupply: number;
}

const MONTH_MS = 30 * 24 * 60 * 60 * 1_000;

interface DistributionTemplateEntry {
  application: PactApplication;
  allocationPercent: number;
  initialUnlockPercent: number;
  cliffMonths: number;
  vestingMonths: number;
  description: string;
}

const DISTRIBUTION_TEMPLATE: readonly DistributionTemplateEntry[] = [
  {
    application: "tasks",
    allocationPercent: 25,
    initialUnlockPercent: 10,
    cliffMonths: 3,
    vestingMonths: 36,
    description: "Task incentives and mission execution rewards",
  },
  {
    application: "pay",
    allocationPercent: 12,
    initialUnlockPercent: 15,
    cliffMonths: 0,
    vestingMonths: 24,
    description: "Payment rails liquidity and routing incentives",
  },
  {
    application: "id",
    allocationPercent: 8,
    initialUnlockPercent: 15,
    cliffMonths: 0,
    vestingMonths: 18,
    description: "Identity staking and verifiable credential incentives",
  },
  {
    application: "data",
    allocationPercent: 12,
    initialUnlockPercent: 10,
    cliffMonths: 3,
    vestingMonths: 30,
    description: "Data marketplace mining and provenance rewards",
  },
  {
    application: "compute",
    allocationPercent: 18,
    initialUnlockPercent: 8,
    cliffMonths: 6,
    vestingMonths: 42,
    description: "Compute provider emissions and execution subsidies",
  },
  {
    application: "dev",
    allocationPercent: 10,
    initialUnlockPercent: 12,
    cliffMonths: 6,
    vestingMonths: 36,
    description: "Developer ecosystem grants and plugin incentives",
  },
  {
    application: "ecosystem",
    allocationPercent: 15,
    initialUnlockPercent: 25,
    cliffMonths: 0,
    vestingMonths: 48,
    description: "Treasury, governance, and ecosystem growth",
  },
];

export const TOKENOMICS_MODEL: TokenomicsModel = createDefaultTokenomicsModel();

export function calculateCirculatingSupply(
  timestamp: number,
  model: TokenomicsModel = TOKENOMICS_MODEL,
): number {
  assertFiniteNumber(timestamp, "timestamp");

  const scheduleByApp = new Map<PactApplication, VestingSchedule>(
    model.vestingSchedules.map((schedule) => [schedule.application, schedule]),
  );
  const circulating = model.distribution.reduce((sum, allocation) => {
    const schedule = scheduleByApp.get(allocation.application);
    if (!schedule) {
      throw new Error(`missing vesting schedule for application: ${allocation.application}`);
    }
    return sum + unlockedAmountForAllocation(allocation, schedule, timestamp);
  }, 0);

  return roundTo(Math.min(model.token.totalSupply, circulating), 6);
}

export function getDistribution(model: TokenomicsModel = TOKENOMICS_MODEL): TokenDistribution[] {
  return model.distribution.map((entry) => ({ ...entry }));
}

export function calculateStakingAPY(totalStaked: number, emissionRate: number): number {
  assertFiniteNonNegative(totalStaked, "totalStaked");
  assertFiniteNonNegative(emissionRate, "emissionRate");
  if (totalStaked === 0 || emissionRate === 0) {
    return 0;
  }
  return roundTo((emissionRate / totalStaked) * 100, 4);
}

export function calculateBurnRate(transactionVolume: number, burnPercent: number): number {
  assertFiniteNonNegative(transactionVolume, "transactionVolume");
  assertFiniteNumber(burnPercent, "burnPercent");
  if (burnPercent < 0 || burnPercent > 100) {
    throw new Error("burnPercent must be between 0 and 100");
  }
  return roundTo(transactionVolume * (burnPercent / 100), 6);
}

export function projectTokenSupply(
  months: number,
  model: TokenomicsModel = TOKENOMICS_MODEL,
): TokenSupplyProjection[] {
  assertFiniteInteger(months, "months");
  if (months < 0) {
    throw new Error("months must be non-negative");
  }

  const startTimestamp = Date.now();
  const projections: TokenSupplyProjection[] = [];
  for (let month = 1; month <= months; month += 1) {
    const timestamp = startTimestamp + month * MONTH_MS;
    const circulatingSupply = calculateCirculatingSupply(timestamp, model);
    const lockedSupply = roundTo(Math.max(0, model.token.totalSupply - circulatingSupply), 6);
    projections.push({
      month,
      timestamp,
      circulatingSupply,
      lockedSupply,
      totalSupply: model.token.totalSupply,
    });
  }

  return projections;
}

function createDefaultTokenomicsModel(): TokenomicsModel {
  const token: PactToken = {
    name: "Pact",
    symbol: "PACT",
    decimals: 18,
    totalSupply: 1_000_000_000,
    launchTimestamp: Date.UTC(2026, 0, 1),
  };

  const totalPercent = DISTRIBUTION_TEMPLATE.reduce((sum, entry) => sum + entry.allocationPercent, 0);
  if (roundTo(totalPercent, 6) !== 100) {
    throw new Error("token distribution percentages must total 100");
  }

  const distribution = DISTRIBUTION_TEMPLATE.map((entry) => ({
    application: entry.application,
    allocationPercent: entry.allocationPercent,
    allocationAmount: Math.round((token.totalSupply * entry.allocationPercent) / 100),
    initialUnlockPercent: entry.initialUnlockPercent,
    description: entry.description,
  }));

  const allocatedTotal = distribution.reduce((sum, entry) => sum + entry.allocationAmount, 0);
  const allocationDiff = token.totalSupply - allocatedTotal;
  if (allocationDiff !== 0) {
    const ecosystemAllocation = distribution.find((entry) => entry.application === "ecosystem");
    if (!ecosystemAllocation) {
      throw new Error("ecosystem allocation is required");
    }
    ecosystemAllocation.allocationAmount += allocationDiff;
  }

  const vestingSchedules = DISTRIBUTION_TEMPLATE.map((entry) => ({
    application: entry.application,
    cliffMonths: entry.cliffMonths,
    vestingMonths: entry.vestingMonths,
    startTimestamp: token.launchTimestamp,
  }));

  return {
    token,
    distribution,
    vestingSchedules,
  };
}

function unlockedAmountForAllocation(
  allocation: TokenDistribution,
  schedule: VestingSchedule,
  timestamp: number,
): number {
  const initialUnlock = allocation.allocationAmount * (allocation.initialUnlockPercent / 100);
  const linearUnlockPool = Math.max(0, allocation.allocationAmount - initialUnlock);
  if (timestamp <= schedule.startTimestamp) {
    return initialUnlock;
  }

  if (schedule.vestingMonths <= 0) {
    return allocation.allocationAmount;
  }

  const monthsElapsed = Math.floor((timestamp - schedule.startTimestamp) / MONTH_MS);
  if (monthsElapsed <= schedule.cliffMonths) {
    return initialUnlock;
  }

  const monthsAfterCliff = monthsElapsed - schedule.cliffMonths;
  const vestedRatio = Math.min(1, monthsAfterCliff / schedule.vestingMonths);
  return initialUnlock + linearUnlockPool * vestedRatio;
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
}

function assertFiniteInteger(value: number, name: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }
}

function roundTo(value: number, decimals: number): number {
  const precision = Math.pow(10, decimals);
  return Math.round(value * precision) / precision;
}
