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
      retryCount: 0,
      maxRetries: input.maxRetries ?? this.capabilityPolicy.getMaxAutonomousRetries(),
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

    const nextStatus = mission.status === "InProgress" ? "InProgress" : "InProgress";
    const progressed = this.stateMachine.transition(mission, nextStatus);

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

    let nextStatus: MissionEnvelope["status"] = "UnderReview";
    if (!input.approve) {
      nextStatus = "Failed";
    } else if (input.confidence >= this.capabilityPolicy.getEscalationThresholdScore()) {
      nextStatus = "Settled";
    }

    const transitioned = this.stateMachine.transition(mission, nextStatus);
    const updated: MissionEnvelope = {
      ...transitioned,
      verdicts: [...transitioned.verdicts, verdict],
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

    if (updated.status === "Settled") {
      await this.eventBus.publish({
        name: DomainEvents.MissionSettled,
        payload: { missionId: mission.id },
        createdAt: Date.now(),
      });
    }

    if (updated.status === "Failed") {
      await this.eventBus.publish({
        name: DomainEvents.MissionFailed,
        payload: { missionId: mission.id, reason: verdict.notes ?? "validator_reject" },
        createdAt: Date.now(),
      });
    }

    return verdict;
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
}
