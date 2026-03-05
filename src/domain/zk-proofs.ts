export type ZKProofType = "location" | "completion" | "identity" | "reputation";

export interface ZKProofRequest {
  type: ZKProofType;
  proverId: string;
  challenge: string;
  publicInputs: Record<string, unknown>;
  createdAt: number;
}

export interface ZKProof {
  id: string;
  type: ZKProofType;
  proverId: string;
  commitment: string;
  publicInputs: Record<string, unknown>;
  proof: string;
  verified: boolean;
  createdAt: number;
}

export interface ZKLocationClaim {
  latitude: number;
  longitude: number;
  radius: number;
  timestamp: number;
}

export interface ZKCompletionClaim {
  taskId: string;
  evidenceHash: string;
  completedAt: number;
}

export interface ZKIdentityClaim {
  participantId: string;
  isHuman: boolean;
}

export interface ZKReputationClaim {
  participantId: string;
  minScore: number;
  actualAbove: boolean;
}
