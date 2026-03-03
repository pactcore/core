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
