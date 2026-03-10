import { describe, expect, test } from "bun:test";
import { createApp } from "../src/api/app";
import { createContainer } from "../src/application/container";
import { PactZK } from "../src/application/modules/pact-zk";
import { createDefaultZKArtifactManifest } from "../src/infrastructure/zk/default-zk-artifact-manifest-factory";
import { DeterministicLocalZKProverAdapter } from "../src/infrastructure/zk/deterministic-local-zk-prover-adapter";
import { InMemoryZKArtifactManifestRepository } from "../src/infrastructure/zk/in-memory-zk-artifact-manifest-repository";
import { InMemoryZKProofRepository } from "../src/infrastructure/zk/in-memory-zk-proof-repository";
import { InMemoryZKVerificationReceiptRepository } from "../src/infrastructure/zk/in-memory-zk-verification-receipt-repository";
import { ProductionZKProverBridge } from "../src/infrastructure/zk/production-zk-prover-bridge";

describe("zk prover bridge API", () => {
  test("exposes manifests, runtime health, and traceable receipts end-to-end", async () => {
    const fixture = await createBridgeFixture();
    const app = createApp(undefined, { container: fixture.container });

    const runtimeResponse = await app.request("/zk/bridge/runtime");
    const runtime = (await runtimeResponse.json()) as {
      adapter: string;
      runtimeVersion: string;
      features: { manifestVersioning: boolean; receiptTraceability: boolean };
    };

    const manifestsResponse = await app.request("/zk/manifests?type=location");
    const manifests = (await manifestsResponse.json()) as Array<{
      id: string;
      manifestVersion: string;
      manifestIntegrity: string;
      schemaVersion?: string;
      artifactCount?: number;
    }>;

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
      bridge?: {
        manifestVersion?: string;
        manifestSchemaVersion?: string;
        runtimeVersion?: string;
        traceId?: string;
        publicInputsDigest?: string;
      };
    };

    const verifyResponse = await app.request(`/zk/proofs/${proof.id}/verify`, {
      method: "POST",
    });
    const verifyBody = (await verifyResponse.json()) as {
      valid: boolean;
      receipt?: {
        proofId: string;
        traceId: string;
        manifestVersion: string;
        manifestIntegrity: string;
        publicInputsDigest: string;
        verified: boolean;
      };
    };

    const receiptsResponse = await app.request(`/zk/proofs/${proof.id}/receipts`);
    const receipts = (await receiptsResponse.json()) as Array<{
      proofId: string;
      traceId: string;
      manifestVersion: string;
      manifestIntegrity: string;
      verified: boolean;
    }>;

    const adapterHealthResponse = await app.request("/zk/adapters/health");
    const adapterHealth = (await adapterHealthResponse.json()) as {
      status: string;
      adapters: Array<{ name: string; state: string }>;
    };

    expect(runtimeResponse.status).toBe(200);
    expect(runtime.adapter).toBe("appendix-c-e2e-adapter");
    expect(runtime.runtimeVersion).toBe("0.2.0");
    expect(runtime.features.manifestVersioning).toBe(true);
    expect(runtime.features.receiptTraceability).toBe(true);

    expect(manifestsResponse.status).toBe(200);
    expect(manifests).toHaveLength(1);
    expect(manifests[0]?.manifestVersion).toBe("1.0.0");
    expect(manifests[0]?.schemaVersion).toBe("1.0.0");
    expect(manifests[0]?.artifactCount).toBe(3);
    expect(manifests[0]?.manifestIntegrity.startsWith("sha256:")).toBe(true);

    expect(proofResponse.status).toBe(201);
    expect(proof.bridge?.manifestVersion).toBe("1.0.0");
    expect(proof.bridge?.manifestSchemaVersion).toBe("1.0.0");
    expect(proof.bridge?.runtimeVersion).toBe("0.2.0");
    expect(proof.bridge?.traceId).toBeDefined();
    expect(proof.bridge?.publicInputsDigest?.length).toBe(64);

    expect(verifyResponse.status).toBe(200);
    expect(verifyBody.valid).toBe(true);
    expect(verifyBody.receipt?.proofId).toBe(proof.id);
    expect(verifyBody.receipt?.verified).toBe(true);
    expect(verifyBody.receipt?.manifestIntegrity.startsWith("sha256:")).toBe(true);
    expect(verifyBody.receipt?.publicInputsDigest.length).toBe(64);
    expect(receiptsResponse.status).toBe(200);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.traceId.includes("verify")).toBe(true);

    expect(adapterHealthResponse.status).toBe(200);
    expect(adapterHealth.status).toBe("healthy");
    expect(adapterHealth.adapters.some((entry) => entry.name === "zk-prover-bridge")).toBe(true);
  });

  test("records failed verification receipts for tampered bridge metadata", async () => {
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
      bridge: {
        ...stored!.bridge!,
        publicInputsDigest: "tampered-digest",
      },
    });

    const verifyResponse = await app.request(`/zk/proofs/${proof.id}/verify`, {
      method: "POST",
    });
    const verifyBody = (await verifyResponse.json()) as {
      valid: boolean;
      receipt?: { verified: boolean; details?: Record<string, string> };
    };

    const receiptsResponse = await app.request(`/zk/proofs/${proof.id}/receipts`);
    const receipts = (await receiptsResponse.json()) as Array<{ verified: boolean; details?: Record<string, string> }>;

    expect(verifyResponse.status).toBe(200);
    expect(verifyBody.valid).toBe(false);
    expect(verifyBody.receipt?.verified).toBe(false);
    expect(verifyBody.receipt?.details?.reason).toBe("public_inputs_digest_mismatch");
    expect(receiptsResponse.status).toBe(200);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.verified).toBe(false);
    expect(receipts[0]?.details?.failureStage).toBe("bridge-trace");
  });
});

async function createBridgeFixture() {
  const manifestRepository = new InMemoryZKArtifactManifestRepository();
  await manifestRepository.save(createDefaultZKArtifactManifest("location"));
  await manifestRepository.save(createDefaultZKArtifactManifest("completion"));

  const proofRepository = new InMemoryZKProofRepository();
  const receiptRepository = new InMemoryZKVerificationReceiptRepository();
  const bridge = new ProductionZKProverBridge(
    new DeterministicLocalZKProverAdapter("appendix-c-e2e-adapter"),
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
