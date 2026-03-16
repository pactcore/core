import type { ParticipantRepository, ReputationRepository } from "../contracts";
import { generateId } from "../utils";
import { NotFoundError } from "../../domain/errors";
import type {
  CommitteeConfig,
  CommitteeDecision,
  CommitteeOutcome,
  CommitteeSelectionAudit,
  CommitteeSelectionAuditEntry,
  CommitteeVote,
  ValidatorAccount,
} from "../../domain/dispute-resolution";

export interface StakeValidatorInput {
  validatorId: string;
  stakeCents: number;
  settlementRecipientId?: string;
}

export interface ConfigureCommitteeInput {
  missionId: string;
  committeeSize?: number;
  approvalThreshold?: number;
  rejectionThreshold?: number;
  reviewPeriodMs?: number;
  minStakeCents?: number;
  minValidatorReputation?: number;
  requiredAttestations?: number;
  attestationCount?: number;
  optParamsHash?: string;
}

export interface CastCommitteeVoteInput {
  missionId: string;
  validatorId: string;
  decision: CommitteeDecision;
  reasoning: string;
  optParamsHash?: string;
}

export interface FinalizeCommitteeAccountingInput {
  missionId: string;
  totalValidatorRewardCents: number;
}

export type CommitteeReviewStatus = "pending" | "approved" | "rejected";

export interface CommitteeReview {
  id: string;
  missionId: string;
  config: CommitteeConfig;
  validatorIds: string[];
  votes: CommitteeVote[];
  status: CommitteeReviewStatus;
  outcome?: CommitteeOutcome;
  selectionAudit: CommitteeSelectionAudit;
  optParamsHash?: string;
  attestationCount: number;
  createdAt: number;
  deadlineAt: number;
}

export interface PactCommitteeOptions {
  config?: Partial<CommitteeConfig>;
  now?: () => number;
}

const defaultCommitteeConfig: CommitteeConfig = {
  committeeSize: 3,
  approvalThreshold: 2,
  rejectionThreshold: 2,
  reviewPeriodMs: 24 * 60 * 60 * 1000,
  minStakeCents: 500,
  minValidatorReputation: 60,
  requiredAttestations: 1,
  slashOnDisagreementCount: 2,
  slashAmountCents: 100,
};

export class PactCommittee {
  private readonly config: CommitteeConfig;
  private readonly now: () => number;
  private readonly validatorAccounts = new Map<string, ValidatorAccount>();
  private readonly committeeReviews = new Map<string, CommitteeReview>();

  constructor(
    private readonly participantRepository: ParticipantRepository,
    private readonly reputationRepository: ReputationRepository,
    options: PactCommitteeOptions = {},
  ) {
    this.config = this.resolveConfig(options.config);
    this.now = options.now ?? Date.now;
  }

  async stakeValidator(input: StakeValidatorInput): Promise<ValidatorAccount> {
    const participant = await this.participantRepository.getById(input.validatorId);
    if (!participant) {
      throw new NotFoundError("Participant", input.validatorId);
    }
    if (participant.role !== "validator") {
      throw new Error(`participant ${input.validatorId} is not a validator`);
    }
    if (!Number.isInteger(input.stakeCents) || input.stakeCents < this.config.minStakeCents) {
      throw new Error(`validator stake must be an integer >= ${this.config.minStakeCents}`);
    }

    const reputation = (await this.reputationRepository.get(input.validatorId))?.score ?? 0;
    const current = this.validatorAccounts.get(input.validatorId);
    const timestamp = this.now();
    const account: ValidatorAccount = {
      validatorId: input.validatorId,
      stakeCents: input.stakeCents,
      minStakeCents: this.config.minStakeCents,
      reputation,
      settlementRecipientId: input.settlementRecipientId ?? current?.settlementRecipientId,
      available: true,
      pendingAssignments: current?.pendingAssignments ?? 0,
      consecutiveDisagreements: current?.consecutiveDisagreements ?? 0,
      totalDisagreements: current?.totalDisagreements ?? 0,
      totalSlashAmountCents: current?.totalSlashAmountCents ?? 0,
      appealOutcomes: current?.appealOutcomes ?? 0,
      noShowCount: current?.noShowCount ?? 0,
      stakedAt: current?.stakedAt ?? timestamp,
      lastUpdatedAt: timestamp,
      unstakeRequestedAt: undefined,
    };

    this.validatorAccounts.set(account.validatorId, structuredClone(account));
    return structuredClone(account);
  }

  async requestUnstake(validatorId: string): Promise<ValidatorAccount> {
    const account = this.getValidatorAccountOrThrow(validatorId);
    if (account.pendingAssignments > 0) {
      throw new Error(`validator ${validatorId} has pending committee assignments`);
    }

    const updated: ValidatorAccount = {
      ...account,
      available: false,
      unstakeRequestedAt: this.now(),
      lastUpdatedAt: this.now(),
    };
    this.validatorAccounts.set(validatorId, structuredClone(updated));
    return structuredClone(updated);
  }

  async unstakeValidator(validatorId: string): Promise<void> {
    const account = this.getValidatorAccountOrThrow(validatorId);
    if (account.pendingAssignments > 0) {
      throw new Error(`validator ${validatorId} has pending committee assignments`);
    }
    this.validatorAccounts.delete(validatorId);
  }

  async configureCommittee(input: ConfigureCommitteeInput): Promise<CommitteeReview> {
    if (this.committeeReviews.has(input.missionId)) {
      throw new Error(`committee already configured for mission ${input.missionId}`);
    }

    const config = this.resolveConfig({
      ...this.config,
      committeeSize: input.committeeSize ?? this.config.committeeSize,
      approvalThreshold: input.approvalThreshold ?? this.config.approvalThreshold,
      rejectionThreshold: input.rejectionThreshold ?? this.config.rejectionThreshold,
      reviewPeriodMs: input.reviewPeriodMs ?? this.config.reviewPeriodMs,
      minStakeCents: input.minStakeCents ?? this.config.minStakeCents,
      minValidatorReputation: input.minValidatorReputation ?? this.config.minValidatorReputation,
      requiredAttestations: input.requiredAttestations ?? this.config.requiredAttestations,
      optParamsHash: input.optParamsHash ?? this.config.optParamsHash,
      slashOnDisagreementCount: this.config.slashOnDisagreementCount,
      slashAmountCents: this.config.slashAmountCents,
    });
    const attestationCount = input.attestationCount ?? config.requiredAttestations;
    if (attestationCount < config.requiredAttestations) {
      throw new Error(`committee attestation count ${attestationCount} is below required ${config.requiredAttestations}`);
    }

    const { selected: validators, candidateCount } = this.selectCommitteeValidators(config);
    if (validators.length < config.committeeSize) {
      throw new Error(`insufficient eligible validators for committee size ${config.committeeSize}`);
    }

    const createdAt = this.now();
    const selectionAudit: CommitteeSelectionAudit = {
      selectedAt: createdAt,
      candidateCount,
      entries: validators.map((v): CommitteeSelectionAuditEntry => ({
        validatorId: v.validatorId,
        reputationAtSelection: v.reputation,
        stakeAtSelection: v.stakeCents,
        weightAtSelection: this.computeValidatorWeight(v),
        appealOutcomesAtSelection: v.appealOutcomes,
        noShowCountAtSelection: v.noShowCount,
      })),
    };

    const review: CommitteeReview = {
      id: generateId("committee"),
      missionId: input.missionId,
      config,
      validatorIds: validators.map((validator) => validator.validatorId),
      votes: [],
      status: "pending",
      selectionAudit,
      optParamsHash: config.optParamsHash,
      attestationCount,
      createdAt,
      deadlineAt: createdAt + config.reviewPeriodMs,
    };

    for (const validator of validators) {
      this.validatorAccounts.set(validator.validatorId, {
        ...validator,
        pendingAssignments: validator.pendingAssignments + 1,
        lastUpdatedAt: createdAt,
      });
    }

    this.committeeReviews.set(input.missionId, structuredClone(review));
    return structuredClone(review);
  }

  async castVote(input: CastCommitteeVoteInput): Promise<CommitteeReview> {
    const review = this.getCommitteeOrThrow(input.missionId);
    if (review.status !== "pending") {
      return review;
    }

    this.assertCommitteeOptParamsHash(review, input.optParamsHash);
    if (this.now() > review.deadlineAt) {
      return this.finalizeCommittee(input.missionId);
    }
    if (!review.validatorIds.includes(input.validatorId)) {
      throw new Error(`validator ${input.validatorId} is not assigned to committee ${review.id}`);
    }
    if (review.votes.some((vote) => vote.validatorId === input.validatorId)) {
      throw new Error(`validator ${input.validatorId} already voted on committee ${review.id}`);
    }

    const account = this.getValidatorAccountOrThrow(input.validatorId);
    const votedAt = this.now();
    const vote: CommitteeVote = {
      validatorId: input.validatorId,
      decision: input.decision,
      reasoning: input.reasoning.trim(),
      votedAt,
      weight: this.computeValidatorWeight(account),
      settlementRecipientId: account.settlementRecipientId,
    };

    const updated: CommitteeReview = {
      ...review,
      votes: [...review.votes, vote],
    };

    this.committeeReviews.set(input.missionId, structuredClone(updated));

    if (this.hasReachedThreshold(updated, "approve") || this.hasReachedThreshold(updated, "reject")) {
      return this.finalizeCommittee(input.missionId);
    }

    return structuredClone(updated);
  }

  async finalizeCommittee(missionId: string): Promise<CommitteeReview> {
    const review = this.getCommitteeOrThrow(missionId);
    if (review.status !== "pending") {
      return review;
    }

    const approvals = review.votes.filter((vote) => vote.decision === "approve");
    const rejections = review.votes.filter((vote) => vote.decision === "reject");
    const now = this.now();

    let decision: CommitteeDecision;
    let reason: CommitteeOutcome["reason"];
    if (approvals.length >= review.config.approvalThreshold) {
      decision = "approve";
      reason = "threshold";
    } else if (rejections.length >= review.config.rejectionThreshold) {
      decision = "reject";
      reason = "threshold";
    } else {
      if (now < review.deadlineAt) {
        throw new Error(`committee ${review.id} cannot finalize before threshold or deadline`);
      }
      decision = "reject";
      reason = "deadline";
    }

    const outcome: CommitteeOutcome = {
      decision,
      decidedAt: now,
      reason,
      approvingValidatorIds: approvals.map((vote) => vote.validatorId),
      rejectingValidatorIds: rejections.map((vote) => vote.validatorId),
    };

    const finalized: CommitteeReview = {
      ...review,
      status: decision === "approve" ? "approved" : "rejected",
      outcome,
    };

    this.applyDeviationTracking(finalized);
    this.applyNoShowPenalties(finalized, reason, now);
    this.releaseCommitteeAssignments(finalized.validatorIds, now);
    this.committeeReviews.set(missionId, structuredClone(finalized));
    return structuredClone(finalized);
  }

  async finalizeJobAccounting(input: FinalizeCommitteeAccountingInput): Promise<CommitteeReview> {
    const review = await this.finalizeCommittee(input.missionId);
    if (!review.outcome) {
      return review;
    }

    const alignedValidatorIds = review.outcome.decision === "approve"
      ? review.outcome.approvingValidatorIds
      : review.outcome.rejectingValidatorIds;

    const payouts = this.allocatePayouts(
      input.totalValidatorRewardCents,
      alignedValidatorIds.map((validatorId) => this.resolveSettlementRecipient(validatorId)),
    );

    const updated: CommitteeReview = {
      ...review,
      outcome: {
        ...review.outcome,
        validatorRewardPayouts: payouts,
      },
    };

    this.committeeReviews.set(input.missionId, structuredClone(updated));
    return structuredClone(updated);
  }

  async getCommittee(missionId: string): Promise<CommitteeReview | undefined> {
    const review = this.committeeReviews.get(missionId);
    return review ? structuredClone(review) : undefined;
  }

  async listCommittees(): Promise<CommitteeReview[]> {
    return [...this.committeeReviews.values()]
      .map((review) => structuredClone(review))
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
  }

  async getValidatorAccount(validatorId: string): Promise<ValidatorAccount | undefined> {
    const account = this.validatorAccounts.get(validatorId);
    return account ? structuredClone(account) : undefined;
  }

  async listValidatorAccounts(): Promise<ValidatorAccount[]> {
    return [...this.validatorAccounts.values()]
      .map((account) => structuredClone(account))
      .sort((left, right) => left.validatorId.localeCompare(right.validatorId));
  }

  private selectCommitteeValidators(config: CommitteeConfig): { selected: ValidatorAccount[]; candidateCount: number } {
    const candidates = [...this.validatorAccounts.values()]
      .filter((validator) =>
        validator.available &&
        validator.pendingAssignments === 0 &&
        validator.stakeCents >= config.minStakeCents &&
        validator.reputation >= config.minValidatorReputation,
      )
      .sort((left, right) => {
        const weightDifference = this.computeValidatorWeight(right) - this.computeValidatorWeight(left);
        if (weightDifference !== 0) {
          return weightDifference;
        }
        return left.validatorId.localeCompare(right.validatorId);
      });

    return {
      selected: candidates.slice(0, config.committeeSize).map((v) => structuredClone(v)),
      candidateCount: candidates.length,
    };
  }

  private hasReachedThreshold(review: CommitteeReview, decision: CommitteeDecision): boolean {
    const votes = review.votes.filter((vote) => vote.decision === decision).length;
    return decision === "approve"
      ? votes >= review.config.approvalThreshold
      : votes >= review.config.rejectionThreshold;
  }

  private applyDeviationTracking(review: CommitteeReview): void {
    const finalDecision = review.outcome?.decision;
    if (!finalDecision) {
      return;
    }

    for (const vote of review.votes) {
      const account = this.getValidatorAccountOrThrow(vote.validatorId);
      const disagreed = vote.decision !== finalDecision;
      let nextStake = account.stakeCents;
      let nextConsecutiveDisagreements = disagreed ? account.consecutiveDisagreements + 1 : 0;
      let totalSlashAmountCents = account.totalSlashAmountCents;

      if (disagreed && nextConsecutiveDisagreements >= review.config.slashOnDisagreementCount) {
        const slashAmount = Math.min(review.config.slashAmountCents, nextStake);
        nextStake -= slashAmount;
        totalSlashAmountCents += slashAmount;
        nextConsecutiveDisagreements = 0;
      }

      this.validatorAccounts.set(vote.validatorId, {
        ...account,
        stakeCents: nextStake,
        consecutiveDisagreements: nextConsecutiveDisagreements,
        totalDisagreements: disagreed ? account.totalDisagreements + 1 : account.totalDisagreements,
        totalSlashAmountCents,
        lastUpdatedAt: review.outcome.decidedAt,
      });
    }
  }

  /** Record that a jury/appeal overturned the committee outcome for a mission. */
  async recordAppealOutcome(missionId: string): Promise<void> {
    const review = this.committeeReviews.get(missionId);
    if (!review?.outcome) {
      return;
    }
    // Validators who voted with the losing side have their appeal outcome count incremented.
    const losingDecision: CommitteeDecision = review.outcome.decision === "approve" ? "reject" : "approve";
    const overturnedIds = review.votes
      .filter((v) => v.decision === review.outcome!.decision)
      .map((v) => v.validatorId);

    for (const validatorId of overturnedIds) {
      const account = this.validatorAccounts.get(validatorId);
      if (!account) {
        continue;
      }
      this.validatorAccounts.set(validatorId, {
        ...account,
        appealOutcomes: account.appealOutcomes + 1,
        lastUpdatedAt: this.now(),
      });
    }
    void losingDecision; // suppress unused variable warning
  }

  private applyNoShowPenalties(review: CommitteeReview, reason: CommitteeOutcome["reason"], now: number): void {
    // Only apply no-show penalties when the committee expired at deadline — those who didn't vote are no-shows.
    if (reason !== "deadline") {
      return;
    }
    const voterIds = new Set(review.votes.map((v) => v.validatorId));
    for (const validatorId of review.validatorIds) {
      if (voterIds.has(validatorId)) {
        continue;
      }
      const account = this.validatorAccounts.get(validatorId);
      if (!account) {
        continue;
      }
      this.validatorAccounts.set(validatorId, {
        ...account,
        noShowCount: account.noShowCount + 1,
        lastUpdatedAt: now,
      });
    }
  }

  private releaseCommitteeAssignments(validatorIds: string[], releasedAt: number): void {
    for (const validatorId of validatorIds) {
      const account = this.getValidatorAccountOrThrow(validatorId);
      this.validatorAccounts.set(validatorId, {
        ...account,
        pendingAssignments: Math.max(0, account.pendingAssignments - 1),
        lastUpdatedAt: releasedAt,
      });
    }
  }

  private allocatePayouts(amountCents: number, recipientIds: string[]): Record<string, number> {
    const uniqueRecipientIds = [...new Set(recipientIds.filter((recipientId) => recipientId.length > 0))];
    if (amountCents <= 0 || uniqueRecipientIds.length === 0) {
      return {};
    }

    const share = Math.floor(amountCents / uniqueRecipientIds.length);
    let remainder = amountCents - share * uniqueRecipientIds.length;
    const payouts: Record<string, number> = {};

    for (const recipientId of uniqueRecipientIds) {
      const bonus = remainder > 0 ? 1 : 0;
      payouts[recipientId] = share + bonus;
      if (remainder > 0) {
        remainder -= 1;
      }
    }

    return payouts;
  }

  private resolveSettlementRecipient(validatorId: string): string {
    const account = this.getValidatorAccountOrThrow(validatorId);
    return account.settlementRecipientId ?? validatorId;
  }

  private assertCommitteeOptParamsHash(review: CommitteeReview, providedHash?: string): void {
    if (!review.optParamsHash) {
      return;
    }
    if ((providedHash ?? "").trim() !== review.optParamsHash) {
      throw new Error(`committee ${review.id} opt params hash mismatch`);
    }
  }

  private computeValidatorWeight(account: ValidatorAccount): number {
    // Appeal outcomes reduce weight by 10% each (down to 10% minimum).
    // No-shows reduce weight by 5% each on top of appeal penalties.
    const penaltyMultiplier = Math.max(
      0.1,
      1 - account.appealOutcomes * 0.1 - account.noShowCount * 0.05,
    );
    return account.reputation * Math.max(account.stakeCents, 1) * penaltyMultiplier;
  }

  private getCommitteeOrThrow(missionId: string): CommitteeReview {
    const review = this.committeeReviews.get(missionId);
    if (!review) {
      throw new Error(`committee not found for mission ${missionId}`);
    }
    return structuredClone(review);
  }

  private getValidatorAccountOrThrow(validatorId: string): ValidatorAccount {
    const account = this.validatorAccounts.get(validatorId);
    if (!account) {
      throw new Error(`validator account not found: ${validatorId}`);
    }
    return structuredClone(account);
  }

  private resolveConfig(override: Partial<CommitteeConfig> | undefined): CommitteeConfig {
    const config: CommitteeConfig = {
      ...defaultCommitteeConfig,
      ...override,
    };

    if (!Number.isInteger(config.committeeSize) || config.committeeSize <= 0) {
      throw new Error("committeeSize must be a positive integer");
    }
    if (!Number.isInteger(config.approvalThreshold) || config.approvalThreshold <= 0 || config.approvalThreshold > config.committeeSize) {
      throw new Error("approvalThreshold must be between 1 and committeeSize");
    }
    if (!Number.isInteger(config.rejectionThreshold) || config.rejectionThreshold <= 0 || config.rejectionThreshold > config.committeeSize) {
      throw new Error("rejectionThreshold must be between 1 and committeeSize");
    }
    if (!Number.isInteger(config.reviewPeriodMs) || config.reviewPeriodMs < 0) {
      throw new Error("reviewPeriodMs must be a non-negative integer");
    }
    if (!Number.isInteger(config.minStakeCents) || config.minStakeCents <= 0) {
      throw new Error("minStakeCents must be a positive integer");
    }
    if (!Number.isFinite(config.minValidatorReputation) || config.minValidatorReputation < 0) {
      throw new Error("minValidatorReputation must be a non-negative number");
    }
    if (!Number.isInteger(config.requiredAttestations) || config.requiredAttestations <= 0) {
      throw new Error("requiredAttestations must be a positive integer");
    }
    if (!Number.isInteger(config.slashOnDisagreementCount) || config.slashOnDisagreementCount <= 0) {
      throw new Error("slashOnDisagreementCount must be a positive integer");
    }
    if (!Number.isInteger(config.slashAmountCents) || config.slashAmountCents < 0) {
      throw new Error("slashAmountCents must be a non-negative integer");
    }

    return config;
  }
}
