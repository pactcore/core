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
  DisputeCase,
  DisputeConfig,
  DisputeEvidence,
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
};

export interface DisputeEvidenceInput {
  description: string;
  artifactUris: string[];
}

export interface PactDisputesOptions {
  config?: Partial<DisputeConfig>;
}

export class PactDisputes {
  private readonly config: DisputeConfig;

  constructor(
    private readonly disputeRepository: DisputeRepository,
    private readonly missionRepository: MissionRepository,
    private readonly participantRepository: ParticipantRepository,
    private readonly reputationRepository: ReputationRepository,
    private readonly eventBus: EventBus,
    options: PactDisputesOptions = {},
  ) {
    this.config = this.resolveConfig(options.config);
  }

  async openDispute(
    missionId: string,
    challengerId: string,
    initialEvidence: DisputeEvidenceInput,
  ): Promise<DisputeCase> {
    const mission = await this.getMissionOrThrow(missionId);
    if (mission.status === "Settled" || mission.status === "Cancelled") {
      throw new Error(`mission ${mission.id} is terminal: ${mission.status}`);
    }

    await this.getParticipantOrThrow(challengerId);
    const respondentId = await this.resolveRespondentId(mission, challengerId);

    const now = Date.now();
    const dispute: DisputeCase = {
      id: generateId("dispute"),
      missionId: mission.id,
      challengerId,
      respondentId,
      status: "open",
      evidence: [this.buildEvidence(challengerId, initialEvidence, now)],
      juryVotes: [],
      createdAt: now,
    };

    await this.disputeRepository.save(dispute);
    await this.eventBus.publish({
      name: DomainEvents.DisputeOpened,
      payload: {
        disputeId: dispute.id,
        missionId: dispute.missionId,
        challengerId: dispute.challengerId,
        respondentId: dispute.respondentId,
      },
      createdAt: Date.now(),
    });

    return dispute;
  }

  async submitEvidence(
    disputeId: string,
    submitterId: string,
    evidence: DisputeEvidenceInput,
  ): Promise<DisputeCase> {
    const dispute = await this.getDisputeOrThrow(disputeId);

    if (dispute.status === "jury_vote" || dispute.status === "resolved") {
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
    const submittedAt = Date.now();
    const updated: DisputeCase = {
      ...dispute,
      status: "evidence",
      evidence: [...dispute.evidence, this.buildEvidence(submitterId, evidence, submittedAt)],
    };

    await this.disputeRepository.save(updated);
    await this.eventBus.publish({
      name: DomainEvents.DisputeEvidenceSubmitted,
      payload: {
        disputeId: updated.id,
        missionId: updated.missionId,
        submitterId,
      },
      createdAt: Date.now(),
    });

    return updated;
  }

  async closeEvidencePeriod(disputeId: string): Promise<DisputeCase> {
    const dispute = await this.getDisputeOrThrow(disputeId);

    if (dispute.status === "resolved") {
      throw new Error(`dispute ${dispute.id} is already resolved`);
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
      createdAt: Date.now(),
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

    if (dispute.status === "resolved") {
      throw new Error(`dispute ${dispute.id} is already resolved`);
    }
    if (dispute.status !== "jury_vote") {
      throw new Error(`dispute ${dispute.id} is not open for jury voting`);
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

    const updated: DisputeCase = {
      ...dispute,
      juryVotes: [
        ...dispute.juryVotes,
        {
          jurorId,
          vote,
          reasoning: reasoning.trim(),
          votedAt: Date.now(),
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
      createdAt: Date.now(),
    });

    if (this.hasQuorum(updated)) {
      return this.resolveFromSnapshot(updated);
    }

    return updated;
  }

  async resolveDispute(disputeId: string): Promise<DisputeCase> {
    let dispute = await this.getDisputeOrThrow(disputeId);

    if (dispute.status === "resolved") {
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

    return this.resolveFromSnapshot(dispute);
  }

  async getDispute(disputeId: string): Promise<DisputeCase> {
    return this.getDisputeOrThrow(disputeId);
  }

  async listDisputes(status?: DisputeCase["status"]): Promise<DisputeCase[]> {
    return this.disputeRepository.list(status);
  }

  private async resolveFromSnapshot(dispute: DisputeCase): Promise<DisputeCase> {
    const verdict = this.computeVerdict(dispute);
    const resolved: DisputeCase = {
      ...dispute,
      status: "resolved",
      verdict,
      resolvedAt: Date.now(),
    };

    await this.disputeRepository.save(resolved);
    await this.eventBus.publish({
      name: DomainEvents.DisputeResolved,
      payload: {
        disputeId: resolved.id,
        missionId: resolved.missionId,
        outcome: verdict.outcome,
        penaltyBps: verdict.penaltyBps,
      },
      createdAt: Date.now(),
    });

    return resolved;
  }

  private computeVerdict(dispute: DisputeCase): DisputeVerdict {
    const upholdVoters = dispute.juryVotes
      .filter((entry) => entry.vote === "uphold")
      .map((entry) => entry.jurorId);
    const rejectVoters = dispute.juryVotes
      .filter((entry) => entry.vote === "reject")
      .map((entry) => entry.jurorId);

    const outcome: DisputeVerdict["outcome"] = upholdVoters.length > rejectVoters.length
      ? "upheld"
      : rejectVoters.length > upholdVoters.length
        ? "rejected"
        : "split";

    const rewardedJurors = outcome === "upheld"
      ? upholdVoters
      : outcome === "rejected"
        ? rejectVoters
        : dispute.juryVotes.map((entry) => entry.jurorId);

    return {
      outcome,
      penaltyBps: outcome === "split" ? 0 : DEFAULT_PENALTY_BPS,
      rewardDistribution: this.buildRewardDistribution(rewardedJurors),
    };
  }

  private buildRewardDistribution(jurorIds: string[]): Record<string, number> {
    if (jurorIds.length === 0) {
      return {};
    }

    const distribution: Record<string, number> = {};
    const share = Math.floor(BASIS_POINTS / jurorIds.length);
    let remainder = BASIS_POINTS - share * jurorIds.length;

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

  private hasQuorum(dispute: DisputeCase): boolean {
    return dispute.juryVotes.length >= this.quorumSize();
  }

  private quorumSize(): number {
    return Math.floor(this.config.jurySize / 2) + 1;
  }

  private isEvidencePeriodExpired(dispute: DisputeCase): boolean {
    return Date.now() >= dispute.createdAt + this.config.evidencePeriodMs;
  }

  private isVotingPeriodExpired(dispute: DisputeCase): boolean {
    const votingDeadline = dispute.createdAt + this.config.evidencePeriodMs + this.config.votingPeriodMs;
    return Date.now() >= votingDeadline;
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

    return config;
  }
}
