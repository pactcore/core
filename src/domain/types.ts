import type { CompensationModel } from "./economics";
import type { IdentityLevel } from "./identity-levels";

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

export interface ParticipantStats {
  participantId: string;
  taskCount: number;
  completedTaskCount: number;
  reputation: number;
  hasZKProofOfHumanity: boolean;
  hasPhoneVerification: boolean;
  hasIdVerification: boolean;
}

export interface Participant {
  id: string;
  role: ParticipantRole;
  displayName: string;
  skills: string[];
  location: GeoPoint;
  identityLevel?: IdentityLevel;
  stats?: ParticipantStats;
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

export type ChallengeStakeStatus = "posted" | "returned" | "forfeited";

export interface ChallengeStakeDistribution {
  juryRecipientId: string;
  juryAmountCents: number;
  protocolRecipientId: string;
  protocolAmountCents: number;
}

export interface ChallengeStakePenalty {
  payerId: string;
  payeeId: string;
  amountCents: number;
}

export interface ChallengeStake {
  challengeId: string;
  challengerId: string;
  amountCents: number;
  minimumAmountCents: number;
  assetId: string;
  unit: string;
  status: ChallengeStakeStatus;
  postedAt: number;
  returnedAt?: number;
  forfeitedAt?: number;
  penalty?: ChallengeStakePenalty;
  distribution?: ChallengeStakeDistribution;
}

export type MissionChallengeStatus = "open" | "resolved";

export interface MissionChallenge {
  id: string;
  missionId: string;
  challengerId: string;
  counterpartyId: string;
  reason: "verdict_disagreement" | "low_confidence" | "manual_escalation";
  stake: ChallengeStake;
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

// ── PactCompute types ──────────────────────────────────────────

export interface ComputeProviderCapabilities {
  cpuCores: number;
  memoryMB: number;
  gpuCount: number;
  gpuModel?: string;
}

export type ComputeProviderStatus = "available" | "busy" | "offline";

export interface ComputeProvider {
  id: string;
  name: string;
  capabilities: ComputeProviderCapabilities;
  pricePerCpuSecondCents: number;
  pricePerGpuSecondCents: number;
  pricePerMemoryMBHourCents: number;
  status: ComputeProviderStatus;
  registeredAt: number;
}

export interface ComputeUsageRecord {
  id: string;
  jobId: string;
  providerId: string;
  cpuSeconds: number;
  memoryMBHours: number;
  gpuSeconds: number;
  totalCostCents: number;
  recordedAt: number;
}

export interface ComputeJobResult {
  jobId: string;
  providerId: string;
  status: "completed" | "failed";
  output?: string;
  error?: string;
  usage: ComputeUsageRecord;
  completedAt: number;
}

// ── PactID / DID types ─────────────────────────────────────────

export interface DIDVerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyHex?: string;
}

export interface DIDServiceEndpoint {
  id: string;
  type: string;
  serviceEndpoint: string;
}

export interface DIDDocument {
  id: string; // did:pact:<participantId>
  controller: string;
  verificationMethod: DIDVerificationMethod[];
  service: DIDServiceEndpoint[];
  createdAt: number;
  updatedAt: number;
}

export interface CredentialSubject {
  id: string;
  capability?: string;
  [key: string]: unknown;
}

export interface CredentialProof {
  type: string;
  created: number;
  verificationMethod: string;
  proofValue: string;
}

export interface VerifiableCredential {
  id: string;
  type: string[];
  issuer: string;
  issuanceDate: number;
  expirationDate?: number;
  credentialSubject: CredentialSubject;
  proof: CredentialProof;
}

// ── PactData types ─────────────────────────────────────────────

export interface ProvenanceEdge {
  childId: string;
  parentId: string;
  relationship: string;
  createdAt: number;
}

export interface IntegrityProof {
  assetId: string;
  algorithm: string;
  hash: string;
  provenAt: number;
}

export interface DataAccessPolicy {
  assetId: string;
  allowedParticipantIds: string[];
  isPublic: boolean;
}

// ── PactDev types ──────────────────────────────────────────────

export type PolicyAction = "allow" | "deny" | "require_review";

export interface PolicyRule {
  id: string;
  name: string;
  condition: Record<string, unknown>;
  action: PolicyAction;
  priority: number;
  enabled: boolean;
}

export interface PolicyPackage {
  id: string;
  name: string;
  version: string;
  rules: PolicyRule[];
  ownerId: string;
  createdAt: number;
  updatedAt: number;
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  matchedRules: PolicyRule[];
  deniedBy?: PolicyRule;
}

export type DevIntegrationStatus = "draft" | "active" | "suspended" | "deprecated";

export interface SDKTemplate {
  id: string;
  name: string;
  language: string;
  repoUrl: string;
  description: string;
  tags: string[];
  createdAt: number;
}
