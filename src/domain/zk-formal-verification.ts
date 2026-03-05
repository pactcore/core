import type { CircuitDefinition, CircuitProofLike } from "./zk-circuits";
import { isCircuitProofShapeValid, verifyCircuitConstraints } from "./zk-circuits";

export type SecurityProperty = "soundness" | "completeness" | "zero-knowledge";

export interface FormalProof {
  property: SecurityProperty;
  satisfied: boolean;
  details: string;
  checkedAt: number;
  assumptions: string[];
}

export interface FormalVerificationReport {
  verified: boolean;
  proofs: FormalProof[];
  checkedAt: number;
}

export function verifySoundness(
  circuit: CircuitDefinition,
  publicInputs: Record<string, unknown>,
  proof: CircuitProofLike,
): FormalProof {
  const honestAccepted = verifyCircuitConstraints(circuit, publicInputs, proof);
  const adversarialInputs = mutateInputsForAdversarialCheck(circuit, publicInputs);
  const adversarialAccepted = verifyCircuitConstraints(circuit, adversarialInputs, proof);
  const satisfied = honestAccepted && !adversarialAccepted;

  return {
    property: "soundness",
    satisfied,
    details: satisfied
      ? "Honest statement accepted and adversarial mutation rejected."
      : "Soundness simulation failed: verifier accepted invalid state or rejected honest state.",
    checkedAt: Date.now(),
    assumptions: [
      "Constraint validity approximates statement validity.",
      "Single adversarial mutation is representative for simulation.",
    ],
  };
}

export function verifyCompleteness(
  circuit: CircuitDefinition,
  publicInputs: Record<string, unknown>,
  proof: CircuitProofLike,
): FormalProof {
  const requiredInputsPresent = circuit.constraintSystem.publicInputOrder.every(
    (key) => Object.prototype.hasOwnProperty.call(publicInputs, key) && publicInputs[key] !== undefined,
  );
  const accepted = verifyCircuitConstraints(circuit, publicInputs, proof);
  const satisfied = requiredInputsPresent && accepted;

  return {
    property: "completeness",
    satisfied,
    details: satisfied
      ? "Well-formed statement was accepted by the verifier simulation."
      : "Completeness simulation failed: required inputs or constraints were not satisfied.",
    checkedAt: Date.now(),
    assumptions: [
      "Given proof artifact corresponds to an honest prover run.",
      "Public-input checks model relation completeness at the application level.",
    ],
  };
}

export function verifyZeroKnowledge(
  circuit: CircuitDefinition,
  publicInputs: Record<string, unknown>,
  proof: CircuitProofLike,
): FormalProof {
  const shapeValid = isCircuitProofShapeValid(proof, circuit.constraintSystem.publicInputOrder.length);
  const serializedProof = stableStringify(proof).toLowerCase();
  const leaksWitness = /witness|private[_-]?input|secret|trapdoor/.test(serializedProof);
  const satisfied = shapeValid && !leaksWitness;

  return {
    property: "zero-knowledge",
    satisfied,
    details: satisfied
      ? "Proof artifact shape is valid and no witness leakage markers were detected."
      : "Zero-knowledge simulation failed: proof shape invalid or witness leakage marker detected.",
    checkedAt: Date.now(),
    assumptions: [
      "Leakage is approximated by static artifact inspection.",
      "Witness data should not appear in serialized proof transcripts.",
      `Public input arity checked: ${Object.keys(publicInputs).length}`,
    ],
  };
}

export function verifyFormalSecurityProperties(
  circuit: CircuitDefinition,
  publicInputs: Record<string, unknown>,
  proof: CircuitProofLike,
): FormalVerificationReport {
  const proofs = [
    verifySoundness(circuit, publicInputs, proof),
    verifyCompleteness(circuit, publicInputs, proof),
    verifyZeroKnowledge(circuit, publicInputs, proof),
  ];

  return {
    verified: proofs.every((entry) => entry.satisfied),
    proofs,
    checkedAt: Date.now(),
  };
}

function mutateInputsForAdversarialCheck(
  circuit: CircuitDefinition,
  publicInputs: Record<string, unknown>,
): Record<string, unknown> {
  const mutated = { ...publicInputs };
  const firstKey = circuit.constraintSystem.publicInputOrder[0];
  if (!firstKey) {
    return mutated;
  }

  const lowerKey = firstKey.toLowerCase();
  if (lowerKey.includes("latitude")) {
    mutated[firstKey] = 999;
    return mutated;
  }
  if (lowerKey.includes("longitude")) {
    mutated[firstKey] = 999;
    return mutated;
  }
  if (lowerKey.includes("radius")) {
    mutated[firstKey] = 0;
    return mutated;
  }
  if (lowerKey.includes("timestamp") || lowerKey.includes("completed")) {
    mutated[firstKey] = -1;
    return mutated;
  }
  if (lowerKey.includes("score")) {
    mutated[firstKey] = 999;
    return mutated;
  }
  if (lowerKey.includes("human") || lowerKey.includes("above")) {
    mutated[firstKey] = "not_boolean";
    return mutated;
  }
  if (typeof mutated[firstKey] === "number") {
    mutated[firstKey] = Number.NaN;
    return mutated;
  }
  mutated[firstKey] = "";
  return mutated;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${key}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return String(value);
}
