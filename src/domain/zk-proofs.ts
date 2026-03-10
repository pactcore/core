export type ZKProofType = "location" | "completion" | "identity" | "reputation";

export interface ZKProofBridgeMetadata {
  adapter: string;
  manifestId: string;
  manifestVersion: string;
  manifestIntegrity: string;
  traceId: string;
  proofDigest: string;
  adapterReceiptId?: string;
}

export interface ZKProofRequest {
  type: ZKProofType;
  proverId: string;
  challenge: string;
  publicInputs: Record<string, unknown>;
  createdAt: number;
  manifestVersion?: string;
  traceId?: string;
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
  bridge?: ZKProofBridgeMetadata;
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
