import type { CircuitDefinition } from "./zk-circuits";
import type { ZKProofType } from "./zk-proofs";

export type ZKArtifactRole =
  | "wasm"
  | "r1cs"
  | "proving-key"
  | "verification-key"
  | "srs"
  | "metadata";

export interface ZKArtifactDescriptor {
  role: ZKArtifactRole;
  uri: string;
  version: string;
  integrity: string;
  bytes?: number;
  inlineData?: string;
}

export interface ZKArtifactManifest {
  id: string;
  proofType: ZKProofType;
  manifestVersion: string;
  runtimeVersion: string;
  circuit: Pick<CircuitDefinition, "name" | "version" | "provingSystem">;
  artifacts: ZKArtifactDescriptor[];
  createdAt: number;
  manifestIntegrity: string;
}

export interface ExternalZKProveRequest {
  requestId: string;
  traceId: string;
  proofType: ZKProofType;
  proverId: string;
  challenge: string;
  publicInputs: Record<string, unknown>;
  witness: unknown;
  createdAt: number;
  manifest: ZKArtifactManifest;
}

export interface ExternalZKProveResponse {
  commitment: string;
  proof: string;
  traceId?: string;
  adapterReceiptId?: string;
}

export interface ExternalZKVerifyRequest {
  traceId: string;
  proofId: string;
  proofType: ZKProofType;
  proverId: string;
  commitment: string;
  proof: string;
  publicInputs: Record<string, unknown>;
  createdAt: number;
  manifest: ZKArtifactManifest;
}

export interface ExternalZKVerifyResponse {
  verified: boolean;
  traceId?: string;
  adapterReceiptId?: string;
  details?: Record<string, string>;
}

export interface ZKVerificationReceipt {
  id: string;
  proofId: string;
  proofType: ZKProofType;
  verified: boolean;
  verifier: string;
  manifestId: string;
  manifestVersion: string;
  manifestIntegrity: string;
  proofDigest: string;
  publicInputsDigest: string;
  traceId: string;
  adapterReceiptId?: string;
  details?: Record<string, string>;
  checkedAt: number;
}

export async function hashZKBridgePayload(value: unknown): Promise<string> {
  const payload = stableStringify(value);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeZKArtifactIntegrity(inlineData: string): Promise<string> {
  return `sha256:${await hashZKBridgePayload(inlineData)}`;
}

export async function computeZKManifestIntegrity(
  manifest: Omit<ZKArtifactManifest, "manifestIntegrity">,
): Promise<string> {
  return `sha256:${await hashZKBridgePayload(manifest)}`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};

    for (const key of Object.keys(record).sort()) {
      normalized[key] = normalizeValue(record[key]);
    }

    return normalized;
  }

  return value;
}
