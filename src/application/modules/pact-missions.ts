import type {
  AgentMailbox,
  EventBus,
  MissionRepository,
  ParticipantRepository,
} from "../contracts";
import { DomainEvents } from "../events";
import { generateId } from "../utils";
import { NotFoundError } from "../../domain/errors";
import { CapabilityPolicyEngine } from "../../domain/capability-policy";
import { MissionStateMachine } from "../../domain/mission-state-machine";
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
}

export interface ResolveMissionChallengeInput {
  missionId: string;
  challengeId: string;
  resolverId: string;
  approve: boolean;
  notes?: string;
}

export class PactMissions {
  private readonly stateMachine = new MissionStateMachine();

  constructor(
    private readonly missionRepository: MissionRepository,
    private readonly participantRepository: ParticipantRepository,
    private readonly mailbox: AgentMailbox,
    private readonly eventBus: EventBus,
    private readonly capabilityPolicy: CapabilityPolicyEngine = new CapabilityPolicyEngine(),
  ) {}

  async createMission(input: CreateMissionInput): Promise<MissionEnvelope> {
    const issuer = await this.participantRepository.getById(input.issuerId);
    if (!issuer) {
      throw new NotFoundError("Participant", input.issuerId);
    }

    const now = Date.now();
    const mission: MissionEnvelope = {
      id: generateId("mission"),
      issuerId: input.issuerId,
      title: input.title,
      budgetCents: input.budgetCents,
      context: input.context,
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
      const challenge = this.openChallenge(
        mission,
        "verdict_disagreement",
        verdicts.map((entry) => entry.id),
      );

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
      const challenge = this.openChallenge(mission, "low_confidence", [verdict.id]);
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

    const resolvedChallenge: MissionChallenge = {
      ...challenge,
      status: "resolved",
      resolvedAt: Date.now(),
      resolution: input.approve ? "approved" : "rejected",
      resolutionNotes: input.notes,
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

  private openChallenge(
    mission: MissionEnvelope,
    reason: MissionChallenge["reason"],
    triggeredByVerdictIds: string[],
  ): MissionChallenge {
    return {
      id: generateId("challenge"),
      missionId: mission.id,
      reason,
      status: "open",
      triggeredByVerdictIds,
      openedAt: Date.now(),
    };
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
        reason: challenge.reason,
        triggeredByVerdictIds: challenge.triggeredByVerdictIds,
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
