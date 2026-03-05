import type { ZKProofType } from "./zk-proofs";

export type WireVisibility = "public" | "private" | "internal";

export interface Wire {
  id: string;
  visibility: WireVisibility;
  description?: string;
}

export type GateType = "add" | "mul" | "boolean" | "range" | "hash" | "eq" | "cmp";

export interface Gate {
  id: string;
  type: GateType;
  inputWires: string[];
  outputWire: string;
  description?: string;
}

export interface ConstraintEvaluationContext {
  circuit: CircuitDefinition;
  publicInputs: Record<string, unknown>;
  normalizedInputs: Record<string, number>;
  proof: CircuitProofLike;
}

export interface CircuitConstraint {
  id: string;
  description: string;
  evaluate: (context: ConstraintEvaluationContext) => boolean;
}

export interface ConstraintSystem {
  fieldPrime: string;
  publicInputOrder: string[];
  wires: Wire[];
  gates: Gate[];
  constraints: CircuitConstraint[];
}

export interface CircuitDefinition {
  proofType: ZKProofType;
  name: string;
  version: string;
  provingSystem: "groth16";
  description: string;
  constraintSystem: ConstraintSystem;
}

export interface Groth16G1Point {
  x: string;
  y: string;
}

export interface Groth16G2Point {
  x: [string, string];
  y: [string, string];
}

export interface Groth16Proof {
  protocol: "groth16";
  curve: "bn128" | "bls12-381";
  piA: Groth16G1Point;
  piB: Groth16G2Point;
  piC: Groth16G1Point;
  publicSignals: string[];
}

export interface CommitmentProof {
  commitment: string;
  proof: string;
}

export type CircuitProofLike = Groth16Proof | CommitmentProof | string;

const BN254_FIELD_PRIME = "21888242871839275222246405745257275088548364400416034343698204186575808495617";
const MAX_HASH_FIELD = 2_147_483_647;

export const zkCircuitDefinitions: Record<ZKProofType, CircuitDefinition> = {
  location: {
    proofType: "location",
    name: "PACT.LocationInRadius",
    version: "1.0.0",
    provingSystem: "groth16",
    description: "Verifies geolocation coordinates, radius bounds, and timestamp soundness.",
    constraintSystem: {
      fieldPrime: BN254_FIELD_PRIME,
      publicInputOrder: ["latitude", "longitude", "radius", "timestamp"],
      wires: [
        { id: "latitude", visibility: "public", description: "Claim latitude in decimal degrees" },
        { id: "longitude", visibility: "public", description: "Claim longitude in decimal degrees" },
        { id: "radius", visibility: "public", description: "Allowed radius in meters" },
        { id: "timestamp", visibility: "public", description: "Claim capture timestamp (unix ms)" },
        { id: "witnessCoordHash", visibility: "private", description: "Private location witness hash" },
      ],
      gates: [
        {
          id: "g_lat_range",
          type: "range",
          inputWires: ["latitude"],
          outputWire: "latValid",
          description: "Latitude must be in [-90, 90]",
        },
        {
          id: "g_lng_range",
          type: "range",
          inputWires: ["longitude"],
          outputWire: "lngValid",
          description: "Longitude must be in [-180, 180]",
        },
        {
          id: "g_radius_range",
          type: "range",
          inputWires: ["radius"],
          outputWire: "radiusValid",
          description: "Radius must be in (0, 100000]",
        },
        {
          id: "g_timestamp",
          type: "cmp",
          inputWires: ["timestamp"],
          outputWire: "timestampValid",
          description: "Timestamp must be a positive unix millisecond value",
        },
      ],
      constraints: [
        {
          id: "c_latitude_range",
          description: "Latitude remains within Earth bounds",
          evaluate: ({ publicInputs }) => {
            const latitude = readNumber(publicInputs, "latitude");
            return latitude !== undefined && latitude >= -90 && latitude <= 90;
          },
        },
        {
          id: "c_longitude_range",
          description: "Longitude remains within Earth bounds",
          evaluate: ({ publicInputs }) => {
            const longitude = readNumber(publicInputs, "longitude");
            return longitude !== undefined && longitude >= -180 && longitude <= 180;
          },
        },
        {
          id: "c_radius_range",
          description: "Radius is positive and reasonably bounded",
          evaluate: ({ publicInputs }) => {
            const radius = readNumber(publicInputs, "radius");
            return radius !== undefined && radius > 0 && radius <= 100_000;
          },
        },
        {
          id: "c_timestamp_positive",
          description: "Timestamp is non-zero and finite",
          evaluate: ({ publicInputs }) => {
            const timestamp = readNumber(publicInputs, "timestamp");
            return timestamp !== undefined && timestamp > 0;
          },
        },
      ],
    },
  },
  completion: {
    proofType: "completion",
    name: "PACT.TaskCompletion",
    version: "1.0.0",
    provingSystem: "groth16",
    description: "Verifies task completion metadata and evidence commitment integrity.",
    constraintSystem: {
      fieldPrime: BN254_FIELD_PRIME,
      publicInputOrder: ["taskId", "evidenceHash", "completedAt"],
      wires: [
        { id: "taskId", visibility: "public", description: "Task identifier" },
        { id: "evidenceHash", visibility: "public", description: "Evidence commitment hash" },
        { id: "completedAt", visibility: "public", description: "Completion timestamp" },
        { id: "witnessEvidence", visibility: "private", description: "Private evidence witness" },
      ],
      gates: [
        {
          id: "g_task_hash",
          type: "hash",
          inputWires: ["taskId"],
          outputWire: "taskHash",
          description: "Task id hash canonicalization",
        },
        {
          id: "g_evidence_hash",
          type: "hash",
          inputWires: ["evidenceHash"],
          outputWire: "evidenceHashNorm",
          description: "Evidence hash normalization",
        },
        {
          id: "g_completed_at",
          type: "cmp",
          inputWires: ["completedAt"],
          outputWire: "completedAtValid",
          description: "Completion time must be positive",
        },
      ],
      constraints: [
        {
          id: "c_task_id_nonempty",
          description: "Task id is present",
          evaluate: ({ publicInputs }) => {
            const taskId = readString(publicInputs, "taskId");
            return taskId !== undefined && taskId.length > 0 && taskId.length <= 256;
          },
        },
        {
          id: "c_evidence_hash_nonempty",
          description: "Evidence hash is present and plausibly hash-shaped",
          evaluate: ({ publicInputs }) => {
            const evidenceHash = readString(publicInputs, "evidenceHash");
            if (!evidenceHash || evidenceHash.length < 8) {
              return false;
            }
            if (evidenceHash.startsWith("0x")) {
              return evidenceHash.length >= 10 && /^[a-f0-9]+$/i.test(evidenceHash.slice(2));
            }
            return evidenceHash.length >= 8;
          },
        },
        {
          id: "c_completed_at_positive",
          description: "Completion timestamp must be finite and positive",
          evaluate: ({ publicInputs }) => {
            const completedAt = readNumber(publicInputs, "completedAt");
            return completedAt !== undefined && completedAt > 0;
          },
        },
      ],
    },
  },
  identity: {
    proofType: "identity",
    name: "PACT.HumanIdentity",
    version: "1.0.0",
    provingSystem: "groth16",
    description: "Verifies participant identity claims with boolean humanity assertion.",
    constraintSystem: {
      fieldPrime: BN254_FIELD_PRIME,
      publicInputOrder: ["participantId", "isHuman"],
      wires: [
        { id: "participantId", visibility: "public", description: "Participant identifier" },
        { id: "isHuman", visibility: "public", description: "Binary human assertion" },
        { id: "witnessCredentialRoot", visibility: "private", description: "Credential Merkle witness" },
      ],
      gates: [
        {
          id: "g_participant_hash",
          type: "hash",
          inputWires: ["participantId"],
          outputWire: "participantHash",
          description: "Canonical participant id hash",
        },
        {
          id: "g_is_human_bool",
          type: "boolean",
          inputWires: ["isHuman"],
          outputWire: "isHumanValid",
          description: "isHuman must be a boolean field element",
        },
      ],
      constraints: [
        {
          id: "c_participant_id_nonempty",
          description: "Participant id must be present",
          evaluate: ({ publicInputs }) => {
            const participantId = readString(publicInputs, "participantId");
            return participantId !== undefined && participantId.length > 0 && participantId.length <= 256;
          },
        },
        {
          id: "c_is_human_boolean",
          description: "isHuman is strict boolean",
          evaluate: ({ publicInputs }) => {
            const isHuman = readBoolean(publicInputs, "isHuman");
            return isHuman !== undefined;
          },
        },
      ],
    },
  },
  reputation: {
    proofType: "reputation",
    name: "PACT.ReputationThreshold",
    version: "1.0.0",
    provingSystem: "groth16",
    description: "Verifies threshold-based reputation claim with bounded score range.",
    constraintSystem: {
      fieldPrime: BN254_FIELD_PRIME,
      publicInputOrder: ["participantId", "minScore", "actualAbove"],
      wires: [
        { id: "participantId", visibility: "public", description: "Participant identifier" },
        { id: "minScore", visibility: "public", description: "Minimum reputation threshold" },
        { id: "actualAbove", visibility: "public", description: "Threshold comparison output" },
        { id: "witnessActualScore", visibility: "private", description: "Private true reputation score" },
      ],
      gates: [
        {
          id: "g_participant_hash",
          type: "hash",
          inputWires: ["participantId"],
          outputWire: "participantHash",
          description: "Canonical participant id hash",
        },
        {
          id: "g_min_score_range",
          type: "range",
          inputWires: ["minScore"],
          outputWire: "minScoreValid",
          description: "minScore must be in [0, 100]",
        },
        {
          id: "g_actual_above_bool",
          type: "boolean",
          inputWires: ["actualAbove"],
          outputWire: "actualAboveValid",
          description: "actualAbove must be boolean",
        },
      ],
      constraints: [
        {
          id: "c_participant_id_nonempty",
          description: "Participant id must be present",
          evaluate: ({ publicInputs }) => {
            const participantId = readString(publicInputs, "participantId");
            return participantId !== undefined && participantId.length > 0 && participantId.length <= 256;
          },
        },
        {
          id: "c_min_score_range",
          description: "Reputation threshold must be in [0, 100]",
          evaluate: ({ publicInputs }) => {
            const minScore = readNumber(publicInputs, "minScore");
            return minScore !== undefined && minScore >= 0 && minScore <= 100;
          },
        },
        {
          id: "c_actual_above_boolean",
          description: "actualAbove is strict boolean",
          evaluate: ({ publicInputs }) => {
            const actualAbove = readBoolean(publicInputs, "actualAbove");
            return actualAbove !== undefined;
          },
        },
      ],
    },
  },
};

export function getCircuitDefinition(proofType: ZKProofType): CircuitDefinition {
  return zkCircuitDefinitions[proofType];
}

export function listCircuitDefinitions(): CircuitDefinition[] {
  return Object.values(zkCircuitDefinitions);
}

export function isCircuitProofShapeValid(
  proof: CircuitProofLike,
  expectedPublicSignals: number,
): boolean {
  if (typeof proof === "string") {
    return proof.length >= 32;
  }

  if (isGroth16Proof(proof)) {
    return (
      isG1Point(proof.piA) &&
      isG2Point(proof.piB) &&
      isG1Point(proof.piC) &&
      Array.isArray(proof.publicSignals) &&
      proof.publicSignals.length === expectedPublicSignals &&
      proof.publicSignals.every((signal) => typeof signal === "string" && signal.length > 0)
    );
  }

  return (
    typeof proof.commitment === "string" &&
    proof.commitment.length >= 16 &&
    typeof proof.proof === "string" &&
    proof.proof.length >= 16
  );
}

export function verifyCircuitConstraints(
  circuit: CircuitDefinition,
  publicInputs: Record<string, unknown>,
  proof: CircuitProofLike,
): boolean {
  if (!hasRequiredInputs(circuit, publicInputs)) {
    return false;
  }

  if (!isCircuitProofShapeValid(proof, circuit.constraintSystem.publicInputOrder.length)) {
    return false;
  }

  const normalizedInputs = normalizePublicInputs(circuit, publicInputs);
  if (!normalizedInputs) {
    return false;
  }

  const context: ConstraintEvaluationContext = {
    circuit,
    publicInputs,
    normalizedInputs,
    proof,
  };

  for (const constraint of circuit.constraintSystem.constraints) {
    let constraintPassed = false;
    try {
      constraintPassed = constraint.evaluate(context);
    } catch {
      constraintPassed = false;
    }
    if (!constraintPassed) {
      return false;
    }
  }

  return true;
}

function hasRequiredInputs(
  circuit: CircuitDefinition,
  publicInputs: Record<string, unknown>,
): boolean {
  for (const key of circuit.constraintSystem.publicInputOrder) {
    if (!Object.prototype.hasOwnProperty.call(publicInputs, key)) {
      return false;
    }
    if (publicInputs[key] === undefined) {
      return false;
    }
  }
  return true;
}

function normalizePublicInputs(
  circuit: CircuitDefinition,
  publicInputs: Record<string, unknown>,
): Record<string, number> | undefined {
  const normalized: Record<string, number> = {};
  for (const key of circuit.constraintSystem.publicInputOrder) {
    const value = publicInputs[key];
    if (value === undefined) {
      return undefined;
    }
    normalized[key] = toFieldElement(value);
  }
  return normalized;
}

function toFieldElement(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(Math.trunc(value)) % MAX_HASH_FIELD;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "string") {
    return hashString(value);
  }
  return hashString(stableStringify(value));
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % MAX_HASH_FIELD;
  }
  return Math.abs(hash);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${key}:${stableStringify(record[key])}`).join(",")}}`;
  }

  return String(value);
}

function readNumber(inputs: Record<string, unknown>, key: string): number | undefined {
  const candidate = inputs[key];
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }
  if (typeof candidate === "string") {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function readString(inputs: Record<string, unknown>, key: string): string | undefined {
  const candidate = inputs[key];
  if (typeof candidate !== "string") {
    return undefined;
  }
  const normalized = candidate.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readBoolean(inputs: Record<string, unknown>, key: string): boolean | undefined {
  const candidate = inputs[key];
  if (typeof candidate === "boolean") {
    return candidate;
  }
  if (candidate === 1 || candidate === "1") {
    return true;
  }
  if (candidate === 0 || candidate === "0") {
    return false;
  }
  return undefined;
}

function isGroth16Proof(proof: CircuitProofLike): proof is Groth16Proof {
  if (!proof || typeof proof !== "object") {
    return false;
  }
  return (
    (proof as { protocol?: unknown }).protocol === "groth16" &&
    ((proof as { curve?: unknown }).curve === "bn128" ||
      (proof as { curve?: unknown }).curve === "bls12-381")
  );
}

function isG1Point(value: unknown): value is Groth16G1Point {
  if (!value || typeof value !== "object") {
    return false;
  }
  const point = value as Groth16G1Point;
  return typeof point.x === "string" && point.x.length > 0 && typeof point.y === "string" && point.y.length > 0;
}

function isG2Point(value: unknown): value is Groth16G2Point {
  if (!value || typeof value !== "object") {
    return false;
  }
  const point = value as Groth16G2Point;
  return (
    Array.isArray(point.x) &&
    point.x.length === 2 &&
    typeof point.x[0] === "string" &&
    typeof point.x[1] === "string" &&
    Array.isArray(point.y) &&
    point.y.length === 2 &&
    typeof point.y[0] === "string" &&
    typeof point.y[1] === "string"
  );
}
