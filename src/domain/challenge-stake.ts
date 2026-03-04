import type { ChallengeStake } from "./types";

export interface CreateChallengeStakeInput {
  challengeId: string;
  challengerId: string;
  amountCents: number;
  minimumAmountCents: number;
  assetId: string;
  unit: string;
  postedAt?: number;
}

export interface ChallengeStakePenaltyInput {
  payerId: string;
  payeeId: string;
  amountCents: number;
}

export interface ResolveChallengeStakeUpheldInput {
  resolvedAt?: number;
  penalty: ChallengeStakePenaltyInput;
}

export interface ResolveChallengeStakeRejectedInput {
  resolvedAt?: number;
  juryRecipientId: string;
  protocolRecipientId: string;
  juryAmountCents: number;
  protocolAmountCents: number;
}

const BASIS_POINTS = 10_000;

export function postChallengeStake(input: CreateChallengeStakeInput): ChallengeStake {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("challenge stake amount must be a positive integer (cents)");
  }

  if (!Number.isInteger(input.minimumAmountCents) || input.minimumAmountCents <= 0) {
    throw new Error("minimum challenge stake must be a positive integer (cents)");
  }

  if (input.amountCents < input.minimumAmountCents) {
    throw new Error(
      `challenge stake ${input.amountCents} is below minimum ${input.minimumAmountCents}`,
    );
  }

  return {
    challengeId: input.challengeId,
    challengerId: input.challengerId,
    amountCents: input.amountCents,
    minimumAmountCents: input.minimumAmountCents,
    assetId: input.assetId,
    unit: input.unit,
    status: "posted",
    postedAt: input.postedAt ?? Date.now(),
  };
}

export function settleChallengeStakeUpheld(
  stake: ChallengeStake,
  input: ResolveChallengeStakeUpheldInput,
): ChallengeStake {
  assertStakePosted(stake);

  if (!Number.isInteger(input.penalty.amountCents) || input.penalty.amountCents < 0) {
    throw new Error("challenge penalty must be a non-negative integer (cents)");
  }

  return {
    ...stake,
    status: "returned",
    returnedAt: input.resolvedAt ?? Date.now(),
    penalty: {
      payerId: input.penalty.payerId,
      payeeId: input.penalty.payeeId,
      amountCents: input.penalty.amountCents,
    },
  };
}

export function settleChallengeStakeRejected(
  stake: ChallengeStake,
  input: ResolveChallengeStakeRejectedInput,
): ChallengeStake {
  assertStakePosted(stake);

  if (input.juryAmountCents < 0 || input.protocolAmountCents < 0) {
    throw new Error("forfeiture distribution amounts cannot be negative");
  }

  if (input.juryAmountCents + input.protocolAmountCents !== stake.amountCents) {
    throw new Error("forfeiture distribution must equal the posted challenge stake amount");
  }

  return {
    ...stake,
    status: "forfeited",
    forfeitedAt: input.resolvedAt ?? Date.now(),
    distribution: {
      juryRecipientId: input.juryRecipientId,
      juryAmountCents: input.juryAmountCents,
      protocolRecipientId: input.protocolRecipientId,
      protocolAmountCents: input.protocolAmountCents,
    },
  };
}

export function calculateChallengePenalty(amountCents: number, penaltyBps: number): number {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("stake amount must be a positive integer (cents)");
  }
  if (!Number.isInteger(penaltyBps) || penaltyBps < 0) {
    throw new Error("penalty basis points must be a non-negative integer");
  }

  if (penaltyBps === 0) {
    return 0;
  }

  const penalty = Math.round((amountCents * penaltyBps) / BASIS_POINTS);
  return Math.max(1, penalty);
}

export function splitForfeitedChallengeStake(
  amountCents: number,
  juryShareBps: number,
): { juryAmountCents: number; protocolAmountCents: number } {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("stake amount must be a positive integer (cents)");
  }

  if (!Number.isInteger(juryShareBps) || juryShareBps < 0 || juryShareBps > BASIS_POINTS) {
    throw new Error("jury share basis points must be an integer between 0 and 10000");
  }

  const juryAmountCents = Math.round((amountCents * juryShareBps) / BASIS_POINTS);
  const protocolAmountCents = amountCents - juryAmountCents;

  return {
    juryAmountCents,
    protocolAmountCents,
  };
}

function assertStakePosted(stake: ChallengeStake): void {
  if (stake.status !== "posted") {
    throw new Error(`challenge stake is not mutable from state ${stake.status}`);
  }
}
