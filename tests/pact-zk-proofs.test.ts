import { describe, expect, test } from "bun:test";
import { PactZK } from "../src/application/modules/pact-zk";
import { InMemoryZKProofRepository } from "../src/infrastructure/zk/in-memory-zk-proof-repository";
import { InMemoryZKProver } from "../src/infrastructure/zk/in-memory-zk-prover";
import { InMemoryZKVerifier } from "../src/infrastructure/zk/in-memory-zk-verifier";

function setup() {
  const prover = new InMemoryZKProver("zk-test-secret");
  const verifier = new InMemoryZKVerifier("zk-test-secret");
  const repository = new InMemoryZKProofRepository();
  const pactZK = new PactZK(prover, verifier, repository);
  return { pactZK, repository };
}

describe("PactZK proofs", () => {
  test("generates and verifies a location proof", async () => {
    const { pactZK } = setup();

    const proof = await pactZK.generateLocationProof("worker-1", {
      latitude: 37.7749,
      longitude: -122.4194,
      radius: 250,
      timestamp: Date.now(),
    });

    expect(proof.type).toBe("location");
    expect(proof.verified).toBe(false);

    const valid = await pactZK.verifyProof(proof.id);
    expect(valid).toBe(true);

    const stored = await pactZK.getProof(proof.id);
    expect(stored?.verified).toBe(true);
  });

  test("generates and verifies a completion proof", async () => {
    const { pactZK } = setup();

    const proof = await pactZK.generateCompletionProof("worker-2", {
      taskId: "task-123",
      evidenceHash: "0xabc123",
      completedAt: Date.now(),
    });

    const valid = await pactZK.verifyProof(proof.id);
    expect(valid).toBe(true);
  });

  test("generates and verifies an identity proof", async () => {
    const { pactZK } = setup();

    const proof = await pactZK.generateIdentityProof("worker-3", {
      participantId: "worker-3",
      isHuman: true,
    });

    const valid = await pactZK.verifyProof(proof.id);
    expect(valid).toBe(true);
  });

  test("generates and verifies a reputation proof", async () => {
    const { pactZK } = setup();

    const proof = await pactZK.generateReputationProof("worker-4", {
      participantId: "worker-4",
      minScore: 75,
      actualAbove: true,
    });

    const valid = await pactZK.verifyProof(proof.id);
    expect(valid).toBe(true);
  });

  test("fails verification for a tampered proof", async () => {
    const { pactZK, repository } = setup();

    const proof = await pactZK.generateCompletionProof("worker-5", {
      taskId: "task-999",
      evidenceHash: "0xoriginal",
      completedAt: Date.now(),
    });

    await repository.save({
      ...proof,
      publicInputs: {
        ...proof.publicInputs,
        evidenceHash: "0xtampered",
      },
    });

    const valid = await pactZK.verifyProof(proof.id);
    expect(valid).toBe(false);

    const stored = await pactZK.getProof(proof.id);
    expect(stored?.verified).toBe(false);
  });

  test("lists proofs by prover", async () => {
    const { pactZK } = setup();

    const p1 = await pactZK.generateLocationProof("worker-a", {
      latitude: 40.7128,
      longitude: -74.006,
      radius: 100,
      timestamp: Date.now(),
    });
    const p2 = await pactZK.generateIdentityProof("worker-a", {
      participantId: "worker-a",
      isHuman: true,
    });
    await pactZK.generateReputationProof("worker-b", {
      participantId: "worker-b",
      minScore: 80,
      actualAbove: true,
    });

    const proofs = await pactZK.listProofsByProver("worker-a");
    expect(proofs).toHaveLength(2);
    expect(proofs.map((proof) => proof.id).sort()).toEqual([p1.id, p2.id].sort());
  });

  test("gets proof by id", async () => {
    const { pactZK } = setup();

    const created = await pactZK.generateIdentityProof("worker-6", {
      participantId: "worker-6",
      isHuman: false,
    });

    const stored = await pactZK.getProof(created.id);
    expect(stored).toBeDefined();
    expect(stored?.id).toBe(created.id);
    expect(stored?.proof.length).toBeGreaterThan(0);
  });

  test("returns false when verifying unknown proof id", async () => {
    const { pactZK } = setup();
    const valid = await pactZK.verifyProof("zkp_missing");
    expect(valid).toBe(false);
  });
});
