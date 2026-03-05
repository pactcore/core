import type { PactApplication } from "./token-economics";

export type FeeAppType = PactApplication;

export interface VolumeTier {
  minAmount: number;
  feePercent: number;
}

export interface FeeStructure {
  appType: FeeAppType;
  baseFeePercent: number;
  minFee: number;
  volumeTiers?: VolumeTier[];
}

export interface RevenueShare {
  protocol: number;
  validator: number;
  treasury: number;
  total: number;
}

export const FEE_STRUCTURES: Record<FeeAppType, FeeStructure> = {
  tasks: {
    appType: "tasks",
    baseFeePercent: 2.5,
    minFee: 0.01,
    volumeTiers: [
      { minAmount: 1_000, feePercent: 2.25 },
      { minAmount: 10_000, feePercent: 2.0 },
    ],
  },
  pay: {
    appType: "pay",
    baseFeePercent: 1.2,
    minFee: 0.005,
    volumeTiers: [
      { minAmount: 1_000, feePercent: 1.0 },
      { minAmount: 10_000, feePercent: 0.85 },
    ],
  },
  id: {
    appType: "id",
    baseFeePercent: 0.6,
    minFee: 0.001,
    volumeTiers: [{ minAmount: 5_000, feePercent: 0.45 }],
  },
  data: {
    appType: "data",
    baseFeePercent: 1.8,
    minFee: 0.005,
    volumeTiers: [
      { minAmount: 2_500, feePercent: 1.5 },
      { minAmount: 25_000, feePercent: 1.25 },
    ],
  },
  compute: {
    appType: "compute",
    baseFeePercent: 2.2,
    minFee: 0.01,
    volumeTiers: [
      { minAmount: 5_000, feePercent: 2.0 },
      { minAmount: 50_000, feePercent: 1.7 },
    ],
  },
  dev: {
    appType: "dev",
    baseFeePercent: 1.5,
    minFee: 0.005,
    volumeTiers: [
      { minAmount: 2_000, feePercent: 1.3 },
      { minAmount: 20_000, feePercent: 1.1 },
    ],
  },
  ecosystem: {
    appType: "ecosystem",
    baseFeePercent: 1.0,
    minFee: 0.001,
    volumeTiers: [{ minAmount: 10_000, feePercent: 0.8 }],
  },
};

export function calculateFee(amount: number, appType: FeeAppType): number {
  assertFinitePositive(amount, "amount");
  const structure = getFeeStructure(appType);
  const feePercent = resolveFeePercent(amount, structure);
  const rawFee = amount * (feePercent / 100);
  return roundTo(Math.max(structure.minFee, rawFee), 8);
}

export function getRevenueShare(fee: number): RevenueShare {
  assertFiniteNonNegative(fee, "fee");
  const protocol = roundTo(fee * 0.5, 8);
  const validator = roundTo(fee * 0.3, 8);
  const treasury = roundTo(Math.max(0, fee - protocol - validator), 8);
  return {
    protocol,
    validator,
    treasury,
    total: roundTo(fee, 8),
  };
}

export function getFeeStructure(appType: FeeAppType): FeeStructure {
  const entry = FEE_STRUCTURES[appType];
  return {
    ...entry,
    volumeTiers: entry.volumeTiers?.map((tier) => ({ ...tier })),
  };
}

function resolveFeePercent(amount: number, structure: FeeStructure): number {
  if (!structure.volumeTiers || structure.volumeTiers.length === 0) {
    return structure.baseFeePercent;
  }

  const sortedTiers = [...structure.volumeTiers].sort((a, b) => a.minAmount - b.minAmount);
  let matchedPercent = structure.baseFeePercent;
  for (const tier of sortedTiers) {
    if (amount >= tier.minAmount) {
      matchedPercent = tier.feePercent;
    }
  }
  return matchedPercent;
}

function assertFinitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
}

function roundTo(value: number, decimals: number): number {
  const precision = Math.pow(10, decimals);
  return Math.round(value * precision) / precision;
}
