import type {
  AgentMailbox,
  EventBus,
  MissionRepository,
  ParticipantRepository,
} from "../contracts";
import { DomainEvents } from "../events";
import type { SettlementRecord, SettlementRecordRepository } from "../settlement-records";
import { generateId } from "../utils";
import { CapabilityPolicyEngine } from "../../domain/capability-policy";
import {
  calculateChallengePenalty,
  postChallengeStake,
  settleChallengeStakeRejected,
  settleChallengeStakeUpheld,
  splitForfeitedChallengeStake,
} from "../../domain/challenge-stake";
import { validateCompensationModel } from "../../domain/economics";
import { NotFoundError } from "../../domain/errors";
import { MissionStateMachine } from "../../domain/mission-state-machine";
import type { CompensationModel } from "../../domain/economics";
import type {
  EvidenceBundle,
  ExecutionStep,
  ExecutionStepKind,
  MissionChallenge,
  MissionContext,
  MissionEnvelope,
  ValidationVerdict,
} from "../../domain/types";

export interface CreateMissionInput {
  issuerId: string;
  title: string;
  budgetCents: number;
  context: MissionContext;
  compensationModel?: CompensationModel;
  targetAgentIds?: string[];
  maxRetries?: number;
}

export interface AppendExecutionStepInput {
  missionId: string;
  agentId: string;
  kind: ExecutionStepKind;
  summary: string;
  inputHash?: string;
  outputHash?: string;
}

export interface SubmitEvidenceBundleInput {
  missionId: string;
  agentId: string;
  summary: string;
  artifactUris: string[];
  bundleHash: string;
  stepId?: string;
  signature?: string;
}

export interface RecordVerdictInput {
  missionId: string;
  reviewerId: string;
  approve: boolean;
  confidence: number;
  notes?: string;
  challengeStakeCents?: number;
  challengeCounterpartyId?: string;
}

export interface OpenMissionChallengeInput {
  missionId: string;
  challengerId: string;
  counterpartyId: string;
  reason: MissionChallenge["reason"];
  stakeAmountCents?: number;
  triggeredByVerdictIds?: string[];
  notes?: string;
}

export interface ResolveMissionChallengeInput {
  missionId: string;
  challengeId: string;
  resolverId: string;
  approve: boolean;
  notes?: string;
}

export interface ChallengeStakePolicy {
  minimumStakeCents: number;
  penaltyBps: number;
  juryShareBps: number;
  protocolTreasuryId: string;
  stakeEscrowId: string;
  assetId: string;
  unit: string;
}

export interface PactMissionsOptions {
  settlementRecordRepository?: SettlementRecordRepository;
  challengeStakePolicy?: Partial<ChallengeStakePolicy>;
}

const BASIS_POINTS = 10_000;

const defaultChallengeStakePolicy: ChallengeStakePolicy = {
  minimumStakeCents: 500,
  penaltyBps: 2_000,
  juryShareBps: 7_000,
  protocolTreasuryId: "protocol:treasury",
  stakeEscrowId: "challenge:escrow",
  assetId: "USDC",
  unit: "USDC_CENTS",
};

export class PactMissions {
  private readonly stateMachine = new MissionStateMachine();
  private readonly settlementRecordRepository?: SettlementRecordRepository;
  private readonly challengeStakePolicy: ChallengeStakePolicy;

  constructor(
    private readonly missionRepository: MissionRepository,
    private readonly participantRepository: ParticipantRepository,
    private readonly mailbox: AgentMailbox,
    private readonly eventBus: EventBus,
    private readonly capabilityPolicy: CapabilityPolicyEngine = new CapabilityPolicyEngine(),
    options: PactMissionsOptions = {},
  ) {
    this.settlementRecordRepository = options.settlementRecordRepository;
    this.challengeStakePolicy = this.resolveChallengeStakePolicy(options.challengeStakePolicy);
  }

  async createMission(input: CreateMissionInput): Promise<MissionEnvelope> {
    const issuer = await this.participantRepository.getById(input.issuerId);
    if (!issuer) {
      throw new NotFoundError("Participant", input.issuerId);
    }

    if (input.compensationModel) {
      const validation = validateCompensationModel(input.compensationModel);
      if (!validation.valid) {
        throw new Error(`Invalid compensation model: ${validation.reasons.join("; ")}`);
      }
    }

    const now = Date.now();
    const mission: MissionEnvelope = {
      id: generateId("mission"),
      issuerId: input.issuerId,
      title: input.title,
      budgetCents: input.budgetCents,
      context: input.context,
      compensationModel: input.compensationModel,
      status: "Open",
      targetAgentIds: input.targetAgentIds ?? [],
      executionSteps: [],
      evidenceBundles: [],
      verdicts: [],
      challenges: [],
      retryCount: 0,
      maxRetries: input.maxRetries ?? this.capabilityPolicy.getMaxAutonomousRetries(),
      escalationCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    await this.missionRepository.save(mission);

    for (const agentId of mission.targetAgentIds) {
      await this.mailbox.enqueueInbox(agentId, "mission.available", {
        missionId: mission.id,
        title: mission.title,
      });
    }

    await this.eventBus.publish({
      name: DomainEvents.MissionCreated,
      payload: { mission },
      createdAt: Date.now(),
    });

    return mission;
  }

  async claimMission(missionId: string, agentId: string): Promise<MissionEnvelope> {
    const mission = await this.getMissionOrThrow(missionId);
    const participant = await this.participantRepository.getById(agentId);
    if (!participant) {
      throw new NotFoundError("Participant", agentId);
    }

    this.capabilityPolicy.assert(participant.role, "mission.claim");

    if (mission.targetAgentIds.length > 0 && !mission.targetAgentIds.includes(agentId)) {
      throw new Error(`Agent ${agentId} is not eligible for mission ${mission.id}`);
    }

    const claimed = this.stateMachine.transition(
      {
        ...mission,
        claimedBy: agentId,
      },
      "Claimed",
    );

    await this.missionRepository.save(claimed);

    await this.mailbox.enqueueOutbox(agentId, "mission.claimed", {
      missionId: claimed.id,
    });

    await this.eventBus.publish({
      name: DomainEvents.MissionClaimed,
      payload: { mission: claimed, agentId },
      createdAt: Date.now(),
    });

    return claimed;
  }

  async claimNextOpenMission(agentId: string): Promise<MissionEnvelope | undefined> {
    const missions = await this.missionRepository.list();
    const openMission = missions.find(
      (mission) =>
        mission.status === "Open" &&
        (mission.targetAgentIds.length === 0 || mission.targetAgentIds.includes(agentId)),
    );

    if (!openMission) {
      return undefined;
    }

    return this.claimMission(openMission.id, agentId);
  }

  async appendExecutionStep(input: AppendExecutionStepInput): Promise<ExecutionStep> {
    const mission = await this.getMissionOrThrow(input.missionId);

    if (mission.claimedBy && mission.claimedBy !== input.agentId) {
      throw new Error(`Mission ${mission.id} is claimed by ${mission.claimedBy}`);
    }

    const participant = await this.participantRepository.getById(input.agentId);
    if (!participant) {
      throw new NotFoundError("Participant", input.agentId);
    }
    this.capabilityPolicy.assert(participant.role, "mission.execute");

    const step: ExecutionStep = {
      id: generateId("step"),
      missionId: mission.id,
      agentId: input.agentId,
      kind: input.kind,
      summary: input.summary,
      inputHash: input.inputHash,
      outputHash: input.outputHash,
      createdAt: Date.now(),
    };

    const progressed = this.stateMachine.transition(mission, "InProgress");

    const updated: MissionEnvelope = {
      ...progressed,
      executionSteps: [...progressed.executionSteps, step],
      claimedBy: progressed.claimedBy ?? input.agentId,
      updatedAt: Date.now(),
    };

    await this.missionRepository.save(updated);
    await this.mailbox.enqueueOutbox(input.agentId, "mission.step.recorded", {
      missionId: mission.id,
      stepId: step.id,
    });

    await this.eventBus.publish({
      name: DomainEvents.MissionExecutionStepAppended,
      payload: { missionId: mission.id, step },
      createdAt: Date.now(),
    });

    return step;
  }

  async submitEvidenceBundle(input: SubmitEvidenceBundleInput): Promise<EvidenceBundle> {
    const mission = await this.getMissionOrThrow(input.missionId);
    const participant = await this.participantRepository.getById(input.agentId);
    if (!participant) {
      throw new NotFoundError("Participant", input.agentId);
    }
    this.capabilityPolicy.assert(participant.role, "evidence.submit");

    const evidence: EvidenceBundle = {
      id: generateId("bundle"),
      missionId: mission.id,
      summary: input.summary,
      artifactUris: input.artifactUris,
      bundleHash: input.bundleHash,
      provenance: {
        agentId: input.agentId,
        stepId: input.stepId,
        timestamp: Date.now(),
        signature: input.signature,
      },
      createdAt: Date.now(),
    };

    const reviewed = this.stateMachine.transition(mission, "UnderReview");

    const updated: MissionEnvelope = {
      ...reviewed,
      evidenceBundles: [...reviewed.evidenceBundles, evidence],
      updatedAt: Date.now(),
    };

    await this.missionRepository.save(updated);

    await this.eventBus.publish({
      name: DomainEvents.MissionEvidenceSubmitted,
      payload: { missionId: mission.id, evidence },
      createdAt: Date.now(),
    });

    return evidence;
  }

  async recordVerdict(input: RecordVerdictInput): Promise<ValidationVerdict> {
    const mission = await this.getMissionOrThrow(input.missionId);
    if (mission.status === "Settled" || mission.status === "Cancelled") {
      throw new Error(`Mission ${mission.id} is terminal: ${mission.status}`);
    }

    const reviewer = await this.participantRepository.getById(input.reviewerId);
    if (!reviewer) {
      throw new NotFoundError("Participant", input.reviewerId);
    }

    this.capabilityPolicy.assert(reviewer.role, "verdict.submit");

    const verdict: ValidationVerdict = {
      id: generateId("verdict"),
      missionId: mission.id,
      reviewerId: input.reviewerId,
      approve: input.approve,
      confidence: input.confidence,
      notes: input.notes,
      createdAt: Date.now(),
    };

    const verdicts = [...mission.verdicts, verdict];
    const hasApprove = verdicts.some((entry) => entry.approve);
    const hasReject = verdicts.some((entry) => !entry.approve);

    if (hasApprove && hasReject) {
      const challenge = await this.openChallengeWithStake({
        mission,
        reason: "verdict_disagreement",
        triggeredByVerdictIds: verdicts.map((entry) => entry.id),
        challengerId: input.reviewerId,
        counterpartyId:
          input.challengeCounterpartyId ??
          this.resolveDisagreementCounterpartyId(verdicts, verdict, mission.issuerId),
        stakeAmountCents: input.challengeStakeCents ?? this.challengeStakePolicy.minimumStakeCents,
      });

      const updated: MissionEnvelope = {
        ...this.stateMachine.transition(mission, "UnderReview"),
        verdicts,
        challenges: [...mission.challenges, challenge],
        escalationCount: mission.escalationCount + 1,
        updatedAt: Date.now(),
      };

      await this.missionRepository.save(updated);
      await this.publishVerdictAndChallengeEvents(mission.id, verdict, updated.status, challenge);
      return verdict;
    }

    if (!input.approve) {
      const failed = this.stateMachine.transition(mission, "Failed");
      const updated: MissionEnvelope = {
        ...failed,
        verdicts,
        updatedAt: Date.now(),
      };

      await this.missionRepository.save(updated);
      await this.eventBus.publish({
        name: DomainEvents.MissionVerdictRecorded,
        payload: { missionId: mission.id, verdict, status: updated.status },
        createdAt: Date.now(),
      });
      await this.eventBus.publish({
        name: DomainEvents.MissionFailed,
        payload: { missionId: mission.id, reason: verdict.notes ?? "validator_reject" },
        createdAt: Date.now(),
      });
      return verdict;
    }

    if (input.confidence < this.capabilityPolicy.getEscalationThresholdScore()) {
      const challenge = await this.openChallengeWithStake({
        mission,
        reason: "low_confidence",
        triggeredByVerdictIds: [verdict.id],
        challengerId: input.reviewerId,
        counterpartyId: input.challengeCounterpartyId ?? mission.issuerId,
        stakeAmountCents: input.challengeStakeCents ?? this.challengeStakePolicy.minimumStakeCents,
      });

      const updated: MissionEnvelope = {
        ...this.stateMachine.transition(mission, "UnderReview"),
        verdicts,
        challenges: [...mission.challenges, challenge],
        escalationCount: mission.escalationCount + 1,
        updatedAt: Date.now(),
      };

      await this.missionRepository.save(updated);
      await this.publishVerdictAndChallengeEvents(mission.id, verdict, updated.status, challenge);
      return verdict;
    }

    const settled = this.stateMachine.transition(mission, "Settled");
    const updated: MissionEnvelope = {
      ...settled,
      verdicts,
      updatedAt: Date.now(),
    };

    await this.missionRepository.save(updated);

    if (updated.claimedBy) {
      await this.mailbox.enqueueInbox(updated.claimedBy, "mission.verdict", {
        missionId: updated.id,
        verdictId: verdict.id,
        approve: verdict.approve,
        confidence: verdict.confidence,
      });
    }

    await this.eventBus.publish({
      name: DomainEvents.MissionVerdictRecorded,
      payload: { missionId: mission.id, verdict, status: updated.status },
      createdAt: Date.now(),
    });
    await this.eventBus.publish({
      name: DomainEvents.MissionSettled,
      payload: { missionId: mission.id },
      createdAt: Date.now(),
    });

    return verdict;
  }

  async openMissionChallenge(input: OpenMissionChallengeInput): Promise<MissionEnvelope> {
    const mission = await this.getMissionOrThrow(input.missionId);
    if (mission.status === "Settled" || mission.status === "Cancelled") {
      throw new Error(`Mission ${mission.id} is terminal: ${mission.status}`);
    }

    await this.getParticipantOrThrow(input.challengerId);
    await this.getParticipantOrThrow(input.counterpartyId);

    const challenge = await this.openChallengeWithStake({
      mission,
      reason: input.reason,
      triggeredByVerdictIds: input.triggeredByVerdictIds ?? [],
      challengerId: input.challengerId,
      counterpartyId: input.counterpartyId,
      stakeAmountCents: input.stakeAmountCents ?? this.challengeStakePolicy.minimumStakeCents,
    });

    const updated: MissionEnvelope = {
      ...this.stateMachine.transition(mission, "UnderReview"),
      challenges: [...mission.challenges, challenge],
      escalationCount: mission.escalationCount + 1,
      updatedAt: Date.now(),
    };

    await this.missionRepository.save(updated);

    await this.eventBus.publish({
      name: DomainEvents.MissionChallengeOpened,
      payload: {
        missionId: mission.id,
        challengeId: challenge.id,
        challengerId: challenge.challengerId,
        counterpartyId: challenge.counterpartyId,
        reason: challenge.reason,
        triggeredByVerdictIds: challenge.triggeredByVerdictIds,
        stakeAmountCents: challenge.stake.amountCents,
        notes: input.notes,
      },
      createdAt: Date.now(),
    });

    await this.eventBus.publish({
      name: DomainEvents.MissionEscalated,
      payload: {
        missionId: mission.id,
        challengeId: challenge.id,
        reason: challenge.reason,
      },
      createdAt: Date.now(),
    });

    return updated;
  }

  async retryMission(missionId: string, reason = "automatic_retry"): Promise<MissionEnvelope> {
    const mission = await this.getMissionOrThrow(missionId);
    if (mission.status !== "Failed") {
      throw new Error(`Mission ${mission.id} is not failed and cannot be retried`);
    }

    if (mission.retryCount >= mission.maxRetries) {
      throw new Error(`Mission ${mission.id} exceeded max retries (${mission.maxRetries})`);
    }

    const reopened = this.stateMachine.transition(mission, "Open");
    const updated: MissionEnvelope = {
      ...reopened,
      claimedBy: undefined,
      retryCount: mission.retryCount + 1,
      updatedAt: Date.now(),
    };

    await this.missionRepository.save(updated);

    const recipients = updated.targetAgentIds.length > 0
      ? updated.targetAgentIds
      : updated.executionSteps.map((step) => step.agentId);

    for (const agentId of recipients) {
      await this.mailbox.enqueueInbox(agentId, "mission.retry_available", {
        missionId: updated.id,
        retryCount: updated.retryCount,
      });
    }

    await this.eventBus.publish({
      name: DomainEvents.MissionRetried,
      payload: { missionId: updated.id, retryCount: updated.retryCount, reason },
      createdAt: Date.now(),
    });

    return updated;
  }

  async resolveMissionChallenge(input: ResolveMissionChallengeInput): Promise<MissionEnvelope> {
    const mission = await this.getMissionOrThrow(input.missionId);
    const resolver = await this.participantRepository.getById(input.resolverId);
    if (!resolver) {
      throw new NotFoundError("Participant", input.resolverId);
    }
    this.capabilityPolicy.assert(resolver.role, "verdict.submit");

    const challenge = mission.challenges.find((entry) => entry.id === input.challengeId);
    if (!challenge) {
      throw new Error(`Challenge ${input.challengeId} not found on mission ${mission.id}`);
    }
    if (challenge.status !== "open") {
      throw new Error(`Challenge ${input.challengeId} is already resolved`);
    }

    const resolvedAt = Date.now();
    const resolvedStake = input.approve
      ? await this.resolveUpheldChallengeStake(challenge, resolvedAt)
      : await this.resolveRejectedChallengeStake(challenge, input.resolverId, resolvedAt);

    const resolvedChallenge: MissionChallenge = {
      ...challenge,
      status: "resolved",
      resolvedAt,
      resolution: input.approve ? "approved" : "rejected",
      resolutionNotes: input.notes,
      stake: resolvedStake,
    };

    const updatedChallenges = mission.challenges.map((entry) =>
      entry.id === resolvedChallenge.id ? resolvedChallenge : entry,
    );

    const transitioned = this.stateMachine.transition(mission, input.approve ? "Settled" : "Failed");
    const updated: MissionEnvelope = {
      ...transitioned,
      challenges: updatedChallenges,
      updatedAt: Date.now(),
    };

    await this.missionRepository.save(updated);

    await this.eventBus.publish({
      name: DomainEvents.MissionChallengeResolved,
      payload: {
        missionId: mission.id,
        challengeId: resolvedChallenge.id,
        resolverId: input.resolverId,
        resolution: resolvedChallenge.resolution,
        stakeStatus: resolvedChallenge.stake.status,
      },
      createdAt: Date.now(),
    });

    if (updated.status === "Settled") {
      await this.eventBus.publish({
        name: DomainEvents.MissionSettled,
        payload: { missionId: mission.id },
        createdAt: Date.now(),
      });
    } else {
      await this.eventBus.publish({
        name: DomainEvents.MissionFailed,
        payload: { missionId: mission.id, reason: input.notes ?? "challenge_rejected" },
        createdAt: Date.now(),
      });
    }

    return updated;
  }

  async getMission(missionId: string): Promise<MissionEnvelope> {
    return this.getMissionOrThrow(missionId);
  }

  async listMissions(): Promise<MissionEnvelope[]> {
    return this.missionRepository.list();
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

  private async openChallengeWithStake(input: {
    mission: MissionEnvelope;
    reason: MissionChallenge["reason"];
    triggeredByVerdictIds: string[];
    challengerId: string;
    counterpartyId: string;
    stakeAmountCents: number;
  }): Promise<MissionChallenge> {
    if (input.challengerId === input.counterpartyId) {
      throw new Error("challenge counterparty must be different from challenger");
    }

    await this.getParticipantOrThrow(input.challengerId);
    await this.getParticipantOrThrow(input.counterpartyId);

    const openedAt = Date.now();
    const challengeId = generateId("challenge");
    const stake = postChallengeStake({
      challengeId,
      challengerId: input.challengerId,
      amountCents: input.stakeAmountCents,
      minimumAmountCents: this.challengeStakePolicy.minimumStakeCents,
      assetId: this.challengeStakePolicy.assetId,
      unit: this.challengeStakePolicy.unit,
      postedAt: openedAt,
    });

    const challenge: MissionChallenge = {
      id: challengeId,
      missionId: input.mission.id,
      challengerId: input.challengerId,
      counterpartyId: input.counterpartyId,
      reason: input.reason,
      stake,
      status: "open",
      triggeredByVerdictIds: input.triggeredByVerdictIds,
      openedAt,
    };

    await this.appendChallengeSettlementRecord({
      challenge,
      legId: "challenge-stake-posted",
      eventType: "stake_posted",
      payerId: input.challengerId,
      payeeId: this.challengeStakePolicy.stakeEscrowId,
      amountCents: stake.amountCents,
      occurredAt: openedAt,
      metadata: {
        reason: challenge.reason,
      },
    });

    return challenge;
  }

  private async resolveUpheldChallengeStake(
    challenge: MissionChallenge,
    resolvedAt: number,
  ): Promise<MissionChallenge["stake"]> {
    const penaltyAmountCents = challenge.counterpartyId === challenge.challengerId
      ? 0
      : calculateChallengePenalty(challenge.stake.amountCents, this.challengeStakePolicy.penaltyBps);

    const stake = settleChallengeStakeUpheld(challenge.stake, {
      resolvedAt,
      penalty: {
        payerId: challenge.counterpartyId,
        payeeId: challenge.challengerId,
        amountCents: penaltyAmountCents,
      },
    });

    await this.appendChallengeSettlementRecord({
      challenge,
      legId: "challenge-stake-return",
      eventType: "stake_returned",
      payerId: this.challengeStakePolicy.stakeEscrowId,
      payeeId: challenge.challengerId,
      amountCents: challenge.stake.amountCents,
      occurredAt: resolvedAt,
    });

    if (penaltyAmountCents > 0) {
      await this.appendChallengeSettlementRecord({
        challenge,
        legId: "challenge-upheld-penalty",
        eventType: "upheld_penalty_paid",
        payerId: challenge.counterpartyId,
        payeeId: challenge.challengerId,
        amountCents: penaltyAmountCents,
        occurredAt: resolvedAt,
      });
    }

    return stake;
  }

  private async resolveRejectedChallengeStake(
    challenge: MissionChallenge,
    resolverId: string,
    resolvedAt: number,
  ): Promise<MissionChallenge["stake"]> {
    const split = splitForfeitedChallengeStake(
      challenge.stake.amountCents,
      this.challengeStakePolicy.juryShareBps,
    );

    const stake = settleChallengeStakeRejected(challenge.stake, {
      resolvedAt,
      juryRecipientId: resolverId,
      protocolRecipientId: this.challengeStakePolicy.protocolTreasuryId,
      juryAmountCents: split.juryAmountCents,
      protocolAmountCents: split.protocolAmountCents,
    });

    if (split.juryAmountCents > 0) {
      await this.appendChallengeSettlementRecord({
        challenge,
        legId: "challenge-stake-forfeit-jury",
        eventType: "stake_forfeited_to_jury",
        payerId: this.challengeStakePolicy.stakeEscrowId,
        payeeId: resolverId,
        amountCents: split.juryAmountCents,
        occurredAt: resolvedAt,
      });
    }

    if (split.protocolAmountCents > 0) {
      await this.appendChallengeSettlementRecord({
        challenge,
        legId: "challenge-stake-forfeit-protocol",
        eventType: "stake_forfeited_to_protocol",
        payerId: this.challengeStakePolicy.stakeEscrowId,
        payeeId: this.challengeStakePolicy.protocolTreasuryId,
        amountCents: split.protocolAmountCents,
        occurredAt: resolvedAt,
      });
    }

    return stake;
  }

  private async appendChallengeSettlementRecord(input: {
    challenge: MissionChallenge;
    legId: string;
    eventType: string;
    payerId: string;
    payeeId: string;
    amountCents: number;
    occurredAt: number;
    metadata?: Record<string, string>;
  }): Promise<void> {
    if (!this.settlementRecordRepository) {
      return;
    }

    if (input.amountCents <= 0) {
      return;
    }

    const record: SettlementRecord = {
      id: generateId("settlement-record"),
      settlementId: this.challengeSettlementId(input.challenge.id),
      legId: input.legId,
      assetId: this.challengeStakePolicy.assetId,
      rail: "api_quota",
      connector: "api_quota_allocation",
      payerId: input.payerId,
      payeeId: input.payeeId,
      amount: input.amountCents,
      unit: this.challengeStakePolicy.unit,
      status: "applied",
      externalReference: `mission_challenge:${input.challenge.id}:${input.legId}`,
      connectorMetadata: {
        module: "pact-missions",
        category: "challenge_stake",
        eventType: input.eventType,
        challengeId: input.challenge.id,
        missionId: input.challenge.missionId,
        challengerId: input.challenge.challengerId,
        counterpartyId: input.challenge.counterpartyId,
        ...input.metadata,
      },
      createdAt: input.occurredAt,
    };

    await this.settlementRecordRepository.append(record);
    await this.eventBus.publish({
      name: DomainEvents.EconomicsSettlementRecordCreated,
      payload: {
        settlementId: record.settlementId,
        record,
      },
      createdAt: Date.now(),
    });
  }

  private challengeSettlementId(challengeId: string): string {
    return `challenge-${challengeId}`;
  }

  private resolveDisagreementCounterpartyId(
    verdicts: ValidationVerdict[],
    challengerVerdict: ValidationVerdict,
    fallbackParticipantId: string,
  ): string {
    const opposingVerdict = [...verdicts]
      .reverse()
      .find(
        (verdict) =>
          verdict.id !== challengerVerdict.id && verdict.approve !== challengerVerdict.approve,
      );

    return opposingVerdict?.reviewerId ?? fallbackParticipantId;
  }

  private resolveChallengeStakePolicy(
    override: Partial<ChallengeStakePolicy> | undefined,
  ): ChallengeStakePolicy {
    const policy: ChallengeStakePolicy = {
      ...defaultChallengeStakePolicy,
      ...override,
    };

    if (!Number.isInteger(policy.minimumStakeCents) || policy.minimumStakeCents <= 0) {
      throw new Error("challenge minimum stake must be a positive integer (cents)");
    }
    if (!Number.isInteger(policy.penaltyBps) || policy.penaltyBps < 0 || policy.penaltyBps > BASIS_POINTS) {
      throw new Error("challenge penaltyBps must be an integer between 0 and 10000");
    }
    if (!Number.isInteger(policy.juryShareBps) || policy.juryShareBps < 0 || policy.juryShareBps > BASIS_POINTS) {
      throw new Error("challenge juryShareBps must be an integer between 0 and 10000");
    }

    return policy;
  }

  private async publishVerdictAndChallengeEvents(
    missionId: string,
    verdict: ValidationVerdict,
    status: MissionEnvelope["status"],
    challenge: MissionChallenge,
  ): Promise<void> {
    await this.eventBus.publish({
      name: DomainEvents.MissionVerdictRecorded,
      payload: { missionId, verdict, status },
      createdAt: Date.now(),
    });

    await this.eventBus.publish({
      name: DomainEvents.MissionChallengeOpened,
      payload: {
        missionId,
        challengeId: challenge.id,
        challengerId: challenge.challengerId,
        counterpartyId: challenge.counterpartyId,
        reason: challenge.reason,
        triggeredByVerdictIds: challenge.triggeredByVerdictIds,
        stakeAmountCents: challenge.stake.amountCents,
      },
      createdAt: Date.now(),
    });

    await this.eventBus.publish({
      name: DomainEvents.MissionEscalated,
      payload: {
        missionId,
        challengeId: challenge.id,
        reason: challenge.reason,
      },
      createdAt: Date.now(),
    });
  }
}
