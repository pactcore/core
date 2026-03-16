import type {
  DisputeRepository,
  EventBus,
  MissionRepository,
  ParticipantRepository,
  ReputationRepository,
} from "../contracts";
import { DomainEvents } from "../events";
import { generateId } from "../utils";
import { NotFoundError } from "../../domain/errors";
import type { MissionEnvelope } from "../../domain/types";
import type {
  DisputeBondDistribution,
  DisputeCase,
  DisputeConfig,
  DisputeEvidence,
  DisputeStatus,
  DisputeSubjectType,
  DisputeVerdict,
  JuryVote,
} from "../../domain/dispute-resolution";

const BASIS_POINTS = 10_000;
const DEFAULT_PENALTY_BPS = 2_000;

const defaultDisputeConfig: DisputeConfig = {
  jurySize: 5,
  votingPeriodMs: 24 * 60 * 60 * 1000,
  evidencePeriodMs: 12 * 60 * 60 * 1000,
  minJuryReputation: 60,
  minimumBondCents: 500,
  bondPenaltyBps: DEFAULT_PENALTY_BPS,
  bondJuryShareBps: 7_000,
  protocolTreasuryId: "protocol:treasury",
  bondEscrowId: "dispute:escrow",
  bondAssetId: "USDC",
  bondUnit: "USDC_CENTS",
};

const terminalMissionStatuses = new Set<MissionEnvelope["status"]>(["Settled", "Failed", "Cancelled"]);

export interface DisputeEvidenceInput {
  description: string;
  artifactUris: string[];
  subjectType?: DisputeSubjectType;
  subjectRef?: string;
  evidenceHash?: string;
  bondAmountCents?: number;
}

export interface PactDisputesOptions {
  config?: Partial<DisputeConfig>;
  now?: () => number;
}

export class PactDisputes {
  private readonly config: DisputeConfig;
  private readonly now: () => number;

  constructor(
    private readonly disputeRepository: DisputeRepository,
    private readonly missionRepository: MissionRepository,
    private readonly participantRepository: ParticipantRepository,
    private readonly reputationRepository: ReputationRepository,
    private readonly eventBus: EventBus,
    options: PactDisputesOptions = {},
  ) {
    this.config = this.resolveConfig(options.config);
    this.now = options.now ?? Date.now;
  }

  async openDispute(
    missionId: string,
    challengerId: string,
    initialEvidence: DisputeEvidenceInput,
  ): Promise<DisputeCase> {
    const mission = await this.getMissionOrThrow(missionId);
    if (!terminalMissionStatuses.has(mission.status)) {
      throw new Error(`mission ${mission.id} must be terminal before opening a dispute`);
    }

    await this.getParticipantOrThrow(challengerId);
    const respondentId = await this.resolveRespondentId(mission, challengerId);
    const now = this.now();
    const evidence = this.buildEvidence(challengerId, initialEvidence, now);
    const bondAmountCents = this.resolveBondAmount(initialEvidence.bondAmountCents);
    const subjectType = initialEvidence.subjectType ?? "mission";
    const subjectRef = initialEvidence.subjectRef?.trim() || mission.id;
    const evidenceHash = this.resolveEvidenceHash(initialEvidence, evidence);

    const dispute: DisputeCase = {
      id: generateId("dispute"),
      missionId: mission.id,
      challengerId,
      respondentId,
      status: "open",
      subjectType,
      subjectRef,
      evidenceHash,
      evidence: [evidence],
      juryVotes: [],
      bond: {
        amountCents: bondAmountCents,
        assetId: this.config.bondAssetId,
        unit: this.config.bondUnit,
        status: "escrowed",
        postedAt: now,
      },
      expiry: {
        evidenceDeadlineAt: now + this.config.evidencePeriodMs,
        votingDeadlineAt: now + this.config.evidencePeriodMs + this.config.votingPeriodMs,
      },
      createdAt: now,
      openedAt: now,
    };

    await this.disputeRepository.save(dispute);
    await this.eventBus.publish({
      name: DomainEvents.DisputeOpened,
      payload: {
        disputeId: dispute.id,
        missionId: dispute.missionId,
        challengerId: dispute.challengerId,
        respondentId: dispute.respondentId,
        subjectType: dispute.subjectType,
        subjectRef: dispute.subjectRef,
        evidenceHash: dispute.evidenceHash,
        bondAmountCents: dispute.bond.amountCents,
      },
      createdAt: now,
    });

    return dispute;
  }

  async submitEvidence(
    disputeId: string,
    submitterId: string,
    evidence: DisputeEvidenceInput,
  ): Promise<DisputeCase> {
    const dispute = await this.getDisputeOrThrow(disputeId);

    if (dispute.status === "jury_vote" || dispute.status === "resolved" || dispute.status === "expired") {
      throw new Error(`dispute ${dispute.id} is not accepting evidence`);
    }
    if (submitterId !== dispute.challengerId && submitterId !== dispute.respondentId) {
      throw new Error("only dispute parties can submit evidence");
    }
    if (this.isEvidencePeriodExpired(dispute)) {
      await this.closeEvidencePeriod(dispute.id);
      throw new Error(`evidence period closed for dispute ${dispute.id}`);
    }

    await this.getParticipantOrThrow(submitterId);
    const submittedAt = this.now();
    const updated: DisputeCase = {
      ...dispute,
      status: "evidence",
      evidenceHash: evidence.evidenceHash?.trim() || dispute.evidenceHash,
      evidence: [...dispute.evidence, this.buildEvidence(submitterId, evidence, submittedAt)],
    };

    await this.disputeRepository.save(updated);
    await this.eventBus.publish({
      name: DomainEvents.DisputeEvidenceSubmitted,
      payload: {
        disputeId: updated.id,
        missionId: updated.missionId,
        submitterId,
        evidenceHash: updated.evidenceHash,
      },
      createdAt: submittedAt,
    });

    return updated;
  }

  async closeEvidencePeriod(disputeId: string): Promise<DisputeCase> {
    const dispute = await this.getDisputeOrThrow(disputeId);

    if (dispute.status === "resolved" || dispute.status === "expired") {
      throw new Error(`dispute ${dispute.id} is no longer active`);
    }
    if (dispute.status === "jury_vote") {
      return dispute;
    }

    const updated: DisputeCase = {
      ...dispute,
      status: "jury_vote",
    };

    await this.disputeRepository.save(updated);
    await this.eventBus.publish({
      name: DomainEvents.DisputeEvidenceClosed,
      payload: {
        disputeId: updated.id,
        missionId: updated.missionId,
      },
      createdAt: this.now(),
    });

    return updated;
  }

  async castJuryVote(
    disputeId: string,
    jurorId: string,
    vote: JuryVote["vote"],
    reasoning: string,
  ): Promise<DisputeCase> {
    let dispute = await this.getDisputeOrThrow(disputeId);

    if (dispute.status === "open" || dispute.status === "evidence") {
      if (!this.isEvidencePeriodExpired(dispute)) {
        throw new Error(`dispute ${dispute.id} is still in evidence period`);
      }
      dispute = await this.closeEvidencePeriod(dispute.id);
    }

    if (dispute.status === "resolved" || dispute.status === "expired") {
      throw new Error(`dispute ${dispute.id} is no longer active`);
    }
    if (dispute.status !== "jury_vote") {
      throw new Error(`dispute ${dispute.id} is not open for jury voting`);
    }
    if (this.isVotingPeriodExpired(dispute)) {
      if (dispute.juryVotes.length === 0) {
        await this.expireDispute(dispute.id);
        throw new Error(`dispute ${dispute.id} expired due to jury inactivity`);
      }
      dispute = await this.resolveFromSnapshot(dispute);
      throw new Error(`dispute ${dispute.id} already resolved after voting deadline`);
    }

    const juror = await this.participantRepository.getById(jurorId);
    if (!juror) {
      throw new NotFoundError("Participant", jurorId);
    }
    if (juror.role !== "jury") {
      throw new Error(`participant ${jurorId} is not eligible to vote as jury`);
    }
    if (jurorId === dispute.challengerId || jurorId === dispute.respondentId) {
      throw new Error("dispute parties cannot vote as jurors");
    }
    if (dispute.juryVotes.some((entry) => entry.jurorId === jurorId)) {
      throw new Error(`juror ${jurorId} already voted on dispute ${dispute.id}`);
    }

    const reputation = await this.reputationRepository.get(jurorId);
    const reputationScore = reputation?.score ?? 0;
    if (reputationScore < this.config.minJuryReputation) {
      throw new Error(
        `juror ${jurorId} reputation ${reputationScore} is below minimum ${this.config.minJuryReputation}`,
      );
    }

    const votedAt = this.now();
    const updated: DisputeCase = {
      ...dispute,
      juryVotes: [
        ...dispute.juryVotes,
        {
          jurorId,
          vote,
          reasoning: reasoning.trim(),
          votedAt,
        },
      ],
    };

    await this.disputeRepository.save(updated);
    await this.eventBus.publish({
      name: DomainEvents.DisputeJuryVoteCast,
      payload: {
        disputeId: updated.id,
        missionId: updated.missionId,
        jurorId,
        vote,
      },
      createdAt: votedAt,
    });

    if (this.hasQuorum(updated)) {
      return this.resolveFromSnapshot(updated);
    }

    return updated;
  }

  async resolveDispute(disputeId: string): Promise<DisputeCase> {
    let dispute = await this.getDisputeOrThrow(disputeId);

    if (dispute.status === "resolved" || dispute.status === "expired") {
      return dispute;
    }

    if (dispute.status === "open" || dispute.status === "evidence") {
      if (!this.isEvidencePeriodExpired(dispute)) {
        throw new Error(`cannot resolve dispute ${dispute.id} before evidence period ends`);
      }
      dispute = await this.closeEvidencePeriod(dispute.id);
    }

    if (!this.hasQuorum(dispute) && !this.isVotingPeriodExpired(dispute)) {
      throw new Error(`dispute ${dispute.id} cannot be resolved before quorum or voting timeout`);
    }

    if (this.isVotingPeriodExpired(dispute) && dispute.juryVotes.length === 0) {
      return this.expireFromSnapshot(dispute, "liveness_failure");
    }

    return this.resolveFromSnapshot(dispute);
  }

  async expireDispute(disputeId: string): Promise<DisputeCase> {
    const dispute = await this.getDisputeOrThrow(disputeId);

    if (dispute.status === "expired") {
      return dispute;
    }
    if (dispute.status === "resolved") {
      throw new Error(`dispute ${dispute.id} is already resolved`);
    }
    if (!this.isVotingPeriodExpired(dispute)) {
      throw new Error(`dispute ${dispute.id} cannot expire before the review deadline`);
    }
    if (dispute.juryVotes.length > 0) {
      throw new Error(`dispute ${dispute.id} has jury activity and must be resolved instead of expired`);
    }

    return this.expireFromSnapshot(dispute, "liveness_failure");
  }

  async getDispute(disputeId: string): Promise<DisputeCase> {
    return this.getDisputeOrThrow(disputeId);
  }

  async listDisputes(status?: DisputeStatus): Promise<DisputeCase[]> {
    return this.disputeRepository.list(status);
  }

  private async resolveFromSnapshot(dispute: DisputeCase): Promise<DisputeCase> {
    const resolvedAt = this.now();
    const verdict = this.computeVerdict(dispute, resolvedAt);
    const resolved: DisputeCase = {
      ...dispute,
      status: "resolved",
      verdict,
      bond: {
        ...dispute.bond,
        status: verdict.outcome === "upheld" ? "settled" : "settled",
        releasedAt: resolvedAt,
        distribution: verdict.bondDistribution,
      },
      resolvedAt,
    };

    await this.disputeRepository.save(resolved);
    await this.eventBus.publish({
      name: DomainEvents.DisputeResolved,
      payload: {
        disputeId: resolved.id,
        missionId: resolved.missionId,
        outcome: verdict.outcome,
        penaltyBps: verdict.penaltyBps,
        bondDistribution: verdict.bondDistribution,
      },
      createdAt: resolvedAt,
    });

    return resolved;
  }

  private async expireFromSnapshot(
    dispute: DisputeCase,
    reason: DisputeCase["expiry"]["reason"],
  ): Promise<DisputeCase> {
    const expiredAt = this.now();
    const refundDistribution: DisputeBondDistribution = {
      challengerRefundCents: dispute.bond.amountCents,
      juryAmountCents: 0,
      protocolAmountCents: 0,
      penaltyAmountCents: 0,
    };
    const expired: DisputeCase = {
      ...dispute,
      status: "expired",
      bond: {
        ...dispute.bond,
        status: "refunded",
        releasedAt: expiredAt,
        distribution: refundDistribution,
      },
      expiry: {
        ...dispute.expiry,
        expiredAt,
        reason,
      },
      expiredAt,
    };

    await this.disputeRepository.save(expired);
    await this.eventBus.publish({
      name: DomainEvents.DisputeResolved,
      payload: {
        disputeId: expired.id,
        missionId: expired.missionId,
        outcome: "expired",
        reason,
        bondDistribution: refundDistribution,
      },
      createdAt: expiredAt,
    });

    return expired;
  }

  private computeVerdict(dispute: DisputeCase, resolvedAt: number): DisputeVerdict {
    const upholdVoters = dispute.juryVotes
      .filter((entry) => entry.vote === "uphold")
      .map((entry) => entry.jurorId);
    const rejectVoters = dispute.juryVotes
      .filter((entry) => entry.vote === "reject")
      .map((entry) => entry.jurorId);

    const outcome: DisputeVerdict["outcome"] =
      upholdVoters.length > rejectVoters.length
        ? "upheld"
        : upholdVoters.length < rejectVoters.length
          ? "rejected"
          : "split";
    const rewardedJurors = outcome === "upheld" ? upholdVoters : rejectVoters;

    const bondDistribution = outcome === "upheld"
      ? this.buildUpheldBondDistribution(dispute.bond.amountCents)
      : this.buildRejectedBondDistribution(dispute.bond.amountCents);

    return {
      outcome,
      penaltyBps: outcome === "upheld" ? this.config.bondPenaltyBps : BASIS_POINTS,
      rewardDistribution: this.buildRewardDistribution(rewardedJurors, bondDistribution.juryAmountCents),
      bondDistribution,
    };
  }

  private buildUpheldBondDistribution(amountCents: number): DisputeBondDistribution {
    const penaltyAmountCents = Math.round((amountCents * this.config.bondPenaltyBps) / BASIS_POINTS);
    const juryAmountCents = Math.round((penaltyAmountCents * this.config.bondJuryShareBps) / BASIS_POINTS);
    const protocolAmountCents = penaltyAmountCents - juryAmountCents;

    return {
      challengerRefundCents: amountCents - penaltyAmountCents,
      juryAmountCents,
      protocolAmountCents,
      penaltyAmountCents,
    };
  }

  private buildRejectedBondDistribution(amountCents: number): DisputeBondDistribution {
    const juryAmountCents = Math.round((amountCents * this.config.bondJuryShareBps) / BASIS_POINTS);
    const protocolAmountCents = amountCents - juryAmountCents;

    return {
      challengerRefundCents: 0,
      juryAmountCents,
      protocolAmountCents,
      penaltyAmountCents: amountCents,
    };
  }

  private buildRewardDistribution(jurorIds: string[], totalRewardCents: number): Record<string, number> {
    if (jurorIds.length === 0 || totalRewardCents <= 0) {
      return {};
    }

    const distribution: Record<string, number> = {};
    const share = Math.floor(totalRewardCents / jurorIds.length);
    let remainder = totalRewardCents - share * jurorIds.length;

    for (const jurorId of jurorIds) {
      const bonus = remainder > 0 ? 1 : 0;
      if (remainder > 0) {
        remainder -= 1;
      }
      distribution[jurorId] = share + bonus;
    }

    return distribution;
  }

  private buildEvidence(
    submitterId: string,
    evidence: DisputeEvidenceInput,
    submittedAt: number,
  ): DisputeEvidence {
    const description = evidence.description.trim();
    if (!description) {
      throw new Error("evidence description is required");
    }

    const artifactUris = evidence.artifactUris
      .map((uri) => uri.trim())
      .filter((uri) => uri.length > 0);

    if (artifactUris.length === 0) {
      throw new Error("at least one evidence artifact URI is required");
    }

    return {
      submitterId,
      description,
      artifactUris,
      submittedAt,
    };
  }

  private resolveBondAmount(bondAmountCents?: number): number {
    const amount = bondAmountCents ?? this.config.minimumBondCents;
    if (!Number.isInteger(amount) || amount < this.config.minimumBondCents) {
      throw new Error(`dispute bond must be an integer >= ${this.config.minimumBondCents}`);
    }
    return amount;
  }

  private resolveEvidenceHash(input: DisputeEvidenceInput, evidence: DisputeEvidence): string {
    const provided = input.evidenceHash?.trim();
    if (provided) {
      return provided;
    }

    const source = `${evidence.submitterId}:${evidence.description}:${evidence.artifactUris.join("|")}`;
    let hash = 0;
    for (const char of source) {
      hash = (hash * 31 + char.charCodeAt(0)) % 1_000_000_007;
    }
    return `evidence:${hash.toString(16)}`;
  }

  private hasQuorum(dispute: DisputeCase): boolean {
    return dispute.juryVotes.length >= this.quorumSize();
  }

  private quorumSize(): number {
    return Math.floor(this.config.jurySize / 2) + 1;
  }

  private isEvidencePeriodExpired(dispute: DisputeCase): boolean {
    return this.now() >= dispute.expiry.evidenceDeadlineAt;
  }

  private isVotingPeriodExpired(dispute: DisputeCase): boolean {
    return this.now() >= dispute.expiry.votingDeadlineAt;
  }

  private async getMissionOrThrow(missionId: string): Promise<MissionEnvelope> {
    const mission = await this.missionRepository.getById(missionId);
    if (!mission) {
      throw new NotFoundError("Mission", missionId);
    }
    return mission;
  }

  private async getParticipantOrThrow(participantId: string): Promise<void> {
    const participant = await this.participantRepository.getById(participantId);
    if (!participant) {
      throw new NotFoundError("Participant", participantId);
    }
  }

  private async getDisputeOrThrow(disputeId: string): Promise<DisputeCase> {
    const dispute = await this.disputeRepository.getById(disputeId);
    if (!dispute) {
      throw new NotFoundError("Dispute", disputeId);
    }
    return dispute;
  }

  private async resolveRespondentId(mission: MissionEnvelope, challengerId: string): Promise<string> {
    const candidates = [
      mission.claimedBy,
      mission.executionSteps.find((step) => step.agentId !== challengerId)?.agentId,
      mission.issuerId,
      mission.targetAgentIds.find((agentId) => agentId !== challengerId),
    ];

    const respondentId = candidates.find(
      (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0 && candidate !== challengerId,
    );

    if (!respondentId) {
      throw new Error(`unable to determine respondent for mission ${mission.id}`);
    }

    await this.getParticipantOrThrow(respondentId);
    return respondentId;
  }

  private resolveConfig(override: Partial<DisputeConfig> | undefined): DisputeConfig {
    const config: DisputeConfig = {
      ...defaultDisputeConfig,
      ...override,
    };

    if (!Number.isInteger(config.jurySize) || config.jurySize <= 0) {
      throw new Error("dispute jurySize must be a positive integer");
    }
    if (!Number.isInteger(config.votingPeriodMs) || config.votingPeriodMs < 0) {
      throw new Error("dispute votingPeriodMs must be a non-negative integer");
    }
    if (!Number.isInteger(config.evidencePeriodMs) || config.evidencePeriodMs < 0) {
      throw new Error("dispute evidencePeriodMs must be a non-negative integer");
    }
    if (!Number.isFinite(config.minJuryReputation) || config.minJuryReputation < 0) {
      throw new Error("dispute minJuryReputation must be a non-negative number");
    }
    if (!Number.isInteger(config.minimumBondCents) || config.minimumBondCents <= 0) {
      throw new Error("dispute minimumBondCents must be a positive integer");
    }
    if (!Number.isInteger(config.bondPenaltyBps) || config.bondPenaltyBps < 0 || config.bondPenaltyBps > BASIS_POINTS) {
      throw new Error("dispute bondPenaltyBps must be between 0 and 10000");
    }
    if (!Number.isInteger(config.bondJuryShareBps) || config.bondJuryShareBps < 0 || config.bondJuryShareBps > BASIS_POINTS) {
      throw new Error("dispute bondJuryShareBps must be between 0 and 10000");
    }

    return config;
  }
}
