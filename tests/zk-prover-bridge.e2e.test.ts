import { describe, expect, test } from "bun:test";
import { createApp } from "../src/api/app";
import { createContainer } from "../src/application/container";
import { PactZK } from "../src/application/modules/pact-zk";
import {
  computeZKArtifactIntegrity,
  computeZKManifestIntegrity,
  getCircuitDefinition,
  type ZKArtifactManifest,
} from "../src/index";
import { InMemoryZKArtifactManifestRepository } from "../src/infrastructure/zk/in-memory-zk-artifact-manifest-repository";
import { InMemoryZKProofRepository } from "../src/infrastructure/zk/in-memory-zk-proof-repository";
import { InMemoryZKVerificationReceiptRepository } from "../src/infrastructure/zk/in-memory-zk-verification-receipt-repository";
import { MockExternalZKProverAdapter } from "../src/infrastructure/zk/mock-external-zk-prover-adapter";
import { ProductionZKProverBridge } from "../src/infrastructure/zk/production-zk-prover-bridge";

describe("zk prover bridge API", () => {
  test("verifies bridge-backed proofs and exposes traceable receipts", async () => {
    const fixture = await createBridgeFixture();
    const app = createApp(undefined, { container: fixture.container });

    const proofResponse = await app.request("/zk/proofs/location", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proverId: "field-worker-1",
        claim: {
          latitude: 37.7749,
          longitude: -122.4194,
          radius: 250,
          timestamp: 1_710_000_000_000,
        },
      }),
    });
    const proof = (await proofResponse.json()) as {
      id: string;
      bridge?: { manifestVersion?: string; traceId?: string };
    };

    const verifyResponse = await app.request(`/zk/proofs/${proof.id}/verify`, {
      method: "POST",
    });
    const verifyBody = (await verifyResponse.json()) as {
      valid: boolean;
      receipt?: { proofId: string; traceId: string; manifestVersion: string; verified: boolean };
    };

    const receiptsResponse = await app.request(`/zk/proofs/${proof.id}/receipts`);
    const receipts = (await receiptsResponse.json()) as Array<{
      proofId: string;
      traceId: string;
      manifestVersion: string;
      verified: boolean;
    }>;

    expect(proofResponse.status).toBe(201);
    expect(proof.bridge?.manifestVersion).toBe("1.0.0");
    expect(proof.bridge?.traceId).toBeDefined();
    expect(verifyResponse.status).toBe(200);
    expect(verifyBody.valid).toBe(true);
    expect(verifyBody.receipt?.proofId).toBe(proof.id);
    expect(verifyBody.receipt?.verified).toBe(true);
    expect(receiptsResponse.status).toBe(200);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.traceId.includes("verify")).toBe(true);
  });

  test("records failed verification receipts for tampered proofs", async () => {
    const fixture = await createBridgeFixture();
    const app = createApp(undefined, { container: fixture.container });

    const proofResponse = await app.request("/zk/proofs/completion", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proverId: "worker-2",
        claim: {
          taskId: "task-bridge-e2e",
          evidenceHash: "0xfeed1234",
          completedAt: 1_710_000_000_000,
        },
      }),
    });
    const proof = (await proofResponse.json()) as { id: string };
    const stored = await fixture.proofRepository.getById(proof.id);

    await fixture.proofRepository.save({
      ...stored!,
      publicInputs: {
        ...stored!.publicInputs,
        evidenceHash: "0xtampered9876",
      },
    });

    const verifyResponse = await app.request(`/zk/proofs/${proof.id}/verify`, {
      method: "POST",
    });
    const verifyBody = (await verifyResponse.json()) as {
      valid: boolean;
      receipt?: { verified: boolean };
    };

    const receiptsResponse = await app.request(`/zk/proofs/${proof.id}/receipts`);
    const receipts = (await receiptsResponse.json()) as Array<{ verified: boolean }>;

    expect(verifyResponse.status).toBe(200);
    expect(verifyBody.valid).toBe(false);
    expect(verifyBody.receipt?.verified).toBe(false);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.verified).toBe(false);
  });
});

async function createBridgeFixture() {
  const manifestRepository = new InMemoryZKArtifactManifestRepository();
  await manifestRepository.save(await createManifest("location"));
  await manifestRepository.save(await createManifest("completion"));

  const proofRepository = new InMemoryZKProofRepository();
  const receiptRepository = new InMemoryZKVerificationReceiptRepository();
  const bridge = new ProductionZKProverBridge(
    new MockExternalZKProverAdapter("appendix-c-e2e-adapter"),
    manifestRepository,
  );
  const pactZK = new PactZK(bridge, bridge, proofRepository, receiptRepository);
  const container = {
    ...createContainer(),
    pactZK,
  };

  return {
    container,
    proofRepository,
  };
}

async function createManifest(proofType: "location" | "completion"): Promise<ZKArtifactManifest> {
  const circuit = getCircuitDefinition(proofType);
  const artifacts = [
    {
      role: "wasm" as const,
      uri: `memory://${proofType}/circuit.wasm`,
      version: "1.0.0",
      integrity: await computeZKArtifactIntegrity(`${proofType}-wasm-binary`),
      inlineData: `${proofType}-wasm-binary`,
    },
    {
      role: "proving-key" as const,
      uri: `memory://${proofType}/proving.key`,
      version: "1.0.0",
      integrity: await computeZKArtifactIntegrity(`${proofType}-proving-key`),
      inlineData: `${proofType}-proving-key`,
    },
    {
      role: "verification-key" as const,
      uri: `memory://${proofType}/verification.key`,
      version: "1.0.0",
      integrity: await computeZKArtifactIntegrity(`${proofType}-verification-key`),
      inlineData: `${proofType}-verification-key`,
    },
  ];
  const manifestWithoutIntegrity = {
    id: `manifest-${proofType}`,
    proofType,
    manifestVersion: "1.0.0",
    runtimeVersion: "0.2.0",
    circuit: {
      name: circuit.name,
      version: circuit.version,
      provingSystem: circuit.provingSystem,
    },
    artifacts,
    createdAt: 1_710_000_000_000,
  };

  return {
    ...manifestWithoutIntegrity,
    manifestIntegrity: await computeZKManifestIntegrity(manifestWithoutIntegrity),
  };
}
