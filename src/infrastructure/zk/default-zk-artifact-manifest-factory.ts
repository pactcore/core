import { createHash } from "node:crypto";
import type { ZKArtifactDescriptor, ZKArtifactManifest, ZKIntegrityAlgorithm } from "../../domain/zk-bridge";
import { getCircuitDefinition } from "../../domain/zk-circuits";
import type { ZKProofType } from "../../domain/zk-proofs";

export interface DefaultZKArtifactManifestFactoryOptions {
  manifestVersion?: string;
  runtimeVersion?: string;
  schemaVersion?: string;
  artifactVersion?: string;
  createdAt?: number;
  publishedAt?: number;
}

const DEFAULT_SCHEMA_VERSION = "1.0.0";
const DEFAULT_MANIFEST_VERSION = "1.0.0";
const DEFAULT_RUNTIME_VERSION = "0.2.0";
const DEFAULT_INTEGRITY_ALGORITHM: ZKIntegrityAlgorithm = "sha256";
const DEFAULT_CREATED_AT = 1_710_000_000_000;
const DEFAULT_PROOF_TYPES: ZKProofType[] = ["location", "completion", "identity", "reputation"];

export function createDefaultZKArtifactManifest(
  proofType: ZKProofType,
  options: DefaultZKArtifactManifestFactoryOptions = {},
): ZKArtifactManifest {
  const manifestVersion = options.manifestVersion ?? DEFAULT_MANIFEST_VERSION;
  const runtimeVersion = options.runtimeVersion ?? DEFAULT_RUNTIME_VERSION;
  const schemaVersion = options.schemaVersion ?? DEFAULT_SCHEMA_VERSION;
  const artifactVersion = options.artifactVersion ?? manifestVersion;
  const createdAt = options.createdAt ?? DEFAULT_CREATED_AT;
  const publishedAt = options.publishedAt ?? createdAt;
  const circuit = getCircuitDefinition(proofType);
  const artifacts = [
    createArtifact(proofType, "wasm", `memory://${proofType}/circuit.wasm`, `${proofType}-wasm-binary`, artifactVersion),
    createArtifact(proofType, "proving-key", `memory://${proofType}/proving.key`, `${proofType}-proving-key`, artifactVersion),
    createArtifact(proofType, "verification-key", `memory://${proofType}/verification.key`, `${proofType}-verification-key`, artifactVersion),
  ];
  const manifestWithoutIntegrity = {
    id: `manifest-${proofType}-${manifestVersion}`,
    schemaVersion,
    proofType,
    manifestVersion,
    runtimeVersion,
    integrityAlgorithm: DEFAULT_INTEGRITY_ALGORITHM,
    circuit: {
      name: circuit.name,
      version: circuit.version,
      provingSystem: circuit.provingSystem,
    },
    artifacts,
    createdAt,
    publishedAt,
    artifactCount: artifacts.length,
  } satisfies Omit<ZKArtifactManifest, "manifestIntegrity">;

  return {
    ...manifestWithoutIntegrity,
    manifestIntegrity: computeIntegrity(manifestWithoutIntegrity),
  };
}

export function createDefaultZKArtifactManifests(
  proofTypes: ZKProofType[] = DEFAULT_PROOF_TYPES,
  options: DefaultZKArtifactManifestFactoryOptions = {},
): ZKArtifactManifest[] {
  return proofTypes.map((proofType) => createDefaultZKArtifactManifest(proofType, options));
}

function createArtifact(
  proofType: ZKProofType,
  role: ZKArtifactDescriptor["role"],
  uri: string,
  inlineData: string,
  version: string,
): ZKArtifactDescriptor {
  return {
    role,
    uri,
    version,
    integrityAlgorithm: DEFAULT_INTEGRITY_ALGORITHM,
    integrity: `sha256:${computeBridgeDigest(inlineData)}`,
    source: "inline",
    bytes: new TextEncoder().encode(inlineData).byteLength,
    inlineData,
  };
}

function computeIntegrity(value: unknown): string {
  return `sha256:${computeBridgeDigest(value)}`;
}

function computeBridgeDigest(value: unknown): string {
  return createHash("sha256")
    .update(stableStringify(value))
    .digest("hex");
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
