import type { CompensationModel } from "./economics";

export type TaskStatus = "Created" | "Assigned" | "Submitted" | "Verified" | "Completed";

export type ParticipantRole = "worker" | "validator" | "issuer" | "agent" | "jury";

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface TaskConstraints {
  requiredSkills: string[];
  maxDistanceKm: number;
  minReputation: number;
  capacityRequired: number;
}

export interface ValidationVote {
  participantId: string;
  approve: boolean;
}

export interface ValidationEvidence {
  autoAIScore: number;
  agentVotes: ValidationVote[];
  humanVotes: ValidationVote[];
}

export interface TaskEvidence {
  summary: string;
  artifactUris: string[];
  submittedAt: number;
  validation: ValidationEvidence;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  issuerId: string;
  paymentCents: number;
  constraints: TaskConstraints;
  location: GeoPoint;
  status: TaskStatus;
  assigneeId?: string;
  evidence?: TaskEvidence;
  validatorIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkerProfile {
  id: string;
  skills: string[];
  reputation: number;
  location: GeoPoint;
  capacity: number;
  activeTaskIds: string[];
}

export interface Participant {
  id: string;
  role: ParticipantRole;
  displayName: string;
  skills: string[];
  location: GeoPoint;
}

export interface ReputationRecord {
  participantId: string;
  role: ParticipantRole;
  score: number;
}

export type MissionStatus =
  | "Draft"
  | "Open"
  | "Claimed"
  | "InProgress"
  | "UnderReview"
  | "Settled"
  | "Failed"
  | "Cancelled";

export type ExecutionStepKind =
  | "tool_call"
  | "artifact_produced"
  | "decision"
  | "external_action";

export type AgentCapability =
  | "mission.claim"
  | "mission.execute"
  | "evidence.submit"
  | "verdict.submit"
  | "settlement.trigger"
  | "task.assign"
  | "task.submit";

export interface MissionContext {
  objective: string;
  constraints: string[];
  successCriteria: string[];
  deadlineAt?: number;
}

export interface ExecutionStep {
  id: string;
  missionId: string;
  agentId: string;
  kind: ExecutionStepKind;
  summary: string;
  inputHash?: string;
  outputHash?: string;
  createdAt: number;
}

export interface EvidenceProvenance {
  agentId: string;
  stepId?: string;
  timestamp: number;
  signature?: string;
}

export interface EvidenceBundle {
  id: string;
  missionId: string;
  summary: string;
  artifactUris: string[];
  bundleHash: string;
  provenance: EvidenceProvenance;
  createdAt: number;
}

export interface ValidationVerdict {
  id: string;
  missionId: string;
  reviewerId: string;
  approve: boolean;
  confidence: number;
  notes?: string;
  createdAt: number;
}

export type MissionChallengeStatus = "open" | "resolved";

export interface MissionChallenge {
  id: string;
  missionId: string;
  reason: "verdict_disagreement" | "low_confidence" | "manual_escalation";
  status: MissionChallengeStatus;
  triggeredByVerdictIds: string[];
  openedAt: number;
  resolvedAt?: number;
  resolution?: "approved" | "rejected";
  resolutionNotes?: string;
}

export interface MissionEnvelope {
  id: string;
  issuerId: string;
  title: string;
  budgetCents: number;
  context: MissionContext;
  compensationModel?: CompensationModel;
  status: MissionStatus;
  targetAgentIds: string[];
  claimedBy?: string;
  executionSteps: ExecutionStep[];
  evidenceBundles: EvidenceBundle[];
  verdicts: ValidationVerdict[];
  challenges: MissionChallenge[];
  retryCount: number;
  maxRetries: number;
  escalationCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface CapabilityPolicy {
  roleCapabilities: Partial<Record<ParticipantRole, AgentCapability[]>>;
  maxAutonomousRetries: number;
  escalationThresholdScore: number;
}
