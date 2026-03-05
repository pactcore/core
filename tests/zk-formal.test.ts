import { describe, expect, test } from "bun:test";
import { createApp } from "../src/api/app";
import { PactZK } from "../src/application/modules/pact-zk";
import { getCircuitDefinition, verifyCircuitConstraints } from "../src/domain/zk-circuits";
import {
  verifyCompleteness,
  verifySoundness,
  verifyZeroKnowledge,
} from "../src/domain/zk-formal-verification";
import type { ZKProofType } from "../src/domain/zk-proofs";
import { InMemoryZKProofRepository } from "../src/infrastructure/zk/in-memory-zk-proof-repository";
import { InMemoryZKProver } from "../src/infrastructure/zk/in-memory-zk-prover";
import { InMemoryZKVerifier } from "../src/infrastructure/zk/in-memory-zk-verifier";

function setupPactZK() {
  const prover = new InMemoryZKProver("zk-formal-test-secret");
  const verifier = new InMemoryZKVerifier("zk-formal-test-secret");
  const repository = new InMemoryZKProofRepository();
  const pactZK = new PactZK(prover, verifier, repository);
  return { pactZK, repository };
}

describe("ZK formal verification and circuit specs", () => {
  test("exposes circuit definitions for every proof type", () => {
    const proofTypes: ZKProofType[] = ["location", "completion", "identity", "reputation"];
    for (const proofType of proofTypes) {
      const circuit = getCircuitDefinition(proofType);
      expect(circuit.proofType).toBe(proofType);
      expect(circuit.provingSystem).toBe("groth16");
      expect(circuit.constraintSystem.publicInputOrder.length).toBeGreaterThan(0);
      expect(circuit.constraintSystem.constraints.length).toBeGreaterThan(0);
    }
  });

  test("verifyCircuitConstraints accepts valid location statement", () => {
    const circuit = getCircuitDefinition("location");
    const valid = verifyCircuitConstraints(
      circuit,
      {
        latitude: 37.7749,
        longitude: -122.4194,
        radius: 250,
        timestamp: Date.now(),
      },
      {
        commitment: "a".repeat(64),
        proof: "b".repeat(64),
      },
    );

    expect(valid).toBe(true);
  });

  test("verifyCircuitConstraints rejects invalid location statement", () => {
    const circuit = getCircuitDefinition("location");
    const valid = verifyCircuitConstraints(
      circuit,
      {
        latitude: 120,
        longitude: -122.4194,
        radius: 250,
        timestamp: Date.now(),
      },
      {
        commitment: "a".repeat(64),
        proof: "b".repeat(64),
      },
    );

    expect(valid).toBe(false);
  });

  test("verifyCompleteness passes for valid completion statement", () => {
    const circuit = getCircuitDefinition("completion");
    const result = verifyCompleteness(
      circuit,
      {
        taskId: "task-123",
        evidenceHash: "0xabcdef1234",
        completedAt: Date.now(),
      },
      {
        commitment: "c".repeat(64),
        proof: "d".repeat(64),
      },
    );

    expect(result.property).toBe("completeness");
    expect(result.satisfied).toBe(true);
  });

  test("verifySoundness fails for malformed statement simulation", () => {
    const circuit = getCircuitDefinition("location");
    const result = verifySoundness(
      circuit,
      {
        latitude: 200,
        longitude: -122.4194,
        radius: 250,
        timestamp: Date.now(),
      },
      {
        commitment: "e".repeat(64),
        proof: "f".repeat(64),
      },
    );

    expect(result.property).toBe("soundness");
    expect(result.satisfied).toBe(false);
  });

  test("verifyZeroKnowledge detects witness leakage markers", () => {
    const circuit = getCircuitDefinition("identity");
    const result = verifyZeroKnowledge(
      circuit,
      {
        participantId: "worker-1",
        isHuman: true,
      },
      {
        commitment: "1".repeat(64),
        proof: "2".repeat(64),
        witness: "private_secret",
      } as unknown as { commitment: string; proof: string },
    );

    expect(result.property).toBe("zero-knowledge");
    expect(result.satisfied).toBe(false);
  });

  test("PactZK returns circuit definition by proof type", () => {
    const { pactZK } = setupPactZK();
    const circuit = pactZK.getCircuitDefinition("reputation");
    expect(circuit.proofType).toBe("reputation");
  });

  test("PactZK verifies all formal properties for a valid generated proof", async () => {
    const { pactZK } = setupPactZK();
    const proof = await pactZK.generateCompletionProof("worker-fv-1", {
      taskId: "task-fv-1",
      evidenceHash: "0xabc123def456",
      completedAt: Date.now(),
    });

    const result = await pactZK.verifyFormalProperties(proof.id);
    expect(result).toBeDefined();
    expect(result?.allSatisfied).toBe(true);
    expect(result?.properties).toHaveLength(3);
    expect(result?.properties.every((entry) => entry.satisfied)).toBe(true);
  });

  test("PactZK formal verification fails after tampered public inputs", async () => {
    const { pactZK, repository } = setupPactZK();
    const proof = await pactZK.generateLocationProof("worker-fv-2", {
      latitude: 37.7749,
      longitude: -122.4194,
      radius: 250,
      timestamp: Date.now(),
    });

    await repository.save({
      ...proof,
      publicInputs: {
        ...proof.publicInputs,
        latitude: 200,
      },
    });

    const result = await pactZK.verifyFormalProperties(proof.id);
    expect(result).toBeDefined();
    expect(result?.allSatisfied).toBe(false);
    const soundness = result?.properties.find((entry) => entry.property === "soundness");
    const completeness = result?.properties.find((entry) => entry.property === "completeness");
    expect(soundness?.satisfied).toBe(false);
    expect(completeness?.satisfied).toBe(false);
  });

  test("API route GET /zk/circuits/:type returns circuit definition", async () => {
    const app = createApp();
    const response = await app.request("/zk/circuits/location");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      proofType: string;
      provingSystem: string;
    };
    expect(payload.proofType).toBe("location");
    expect(payload.provingSystem).toBe("groth16");
  });

  test("API route POST /zk/formal-verify/:proofId returns formal verification report", async () => {
    const app = createApp();

    const createdResponse = await app.request("/zk/proofs/identity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proverId: "worker-route-1",
        claim: {
          participantId: "worker-route-1",
          isHuman: true,
        },
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { id: string };

    const formalResponse = await app.request(`/zk/formal-verify/${created.id}`, {
      method: "POST",
    });
    expect(formalResponse.status).toBe(200);
    const payload = (await formalResponse.json()) as {
      proofId: string;
      allSatisfied: boolean;
      properties: Array<{ property: string; satisfied: boolean }>;
    };
    expect(payload.proofId).toBe(created.id);
    expect(payload.allSatisfied).toBe(true);
    expect(payload.properties).toHaveLength(3);
  });
});
