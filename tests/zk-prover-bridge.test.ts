import { describe, expect, test } from "bun:test";
import { AdapterOperationError } from "../src/application/adapter-runtime";
import { PactZK } from "../src/application/modules/pact-zk";
import {
  createDefaultZKArtifactManifest,
  createDefaultZKArtifactManifests,
} from "../src/infrastructure/zk/default-zk-artifact-manifest-factory";
import { DeterministicLocalZKProverAdapter } from "../src/infrastructure/zk/deterministic-local-zk-prover-adapter";
import { InMemoryZKArtifactManifestRepository } from "../src/infrastructure/zk/in-memory-zk-artifact-manifest-repository";
import { InMemoryZKProofRepository } from "../src/infrastructure/zk/in-memory-zk-proof-repository";
import { InMemoryZKVerificationReceiptRepository } from "../src/infrastructure/zk/in-memory-zk-verification-receipt-repository";
import { ProductionZKProverBridge } from "../src/infrastructure/zk/production-zk-prover-bridge";
import { RemoteHttpZKProverAdapterSkeleton } from "../src/infrastructure/zk/remote-http-zk-prover-adapter-skeleton";
import { computeZKArtifactIntegrity, computeZKManifestIntegrity } from "../src/domain/zk-bridge";

describe("ProductionZKProverBridge", () => {
  test("generates bridge metadata, manifests, and verification receipts", async () => {
    const manifestRepository = new InMemoryZKArtifactManifestRepository();
    const receiptRepository = new InMemoryZKVerificationReceiptRepository();
    const manifest = createDefaultZKArtifactManifest("completion");
    await manifestRepository.save(manifest);

    const bridge = new ProductionZKProverBridge(
      new DeterministicLocalZKProverAdapter("appendix-c-adapter"),
      manifestRepository,
    );
    const pactZK = new PactZK(
      bridge,
      bridge,
      new InMemoryZKProofRepository(),
      receiptRepository,
    );

    const proof = await pactZK.generateCompletionProof("worker-appendix-c", {
      taskId: "task-appendix-c",
      evidenceHash: "0xabc1234567",
      completedAt: 1_710_000_000_000,
    });

    expect(proof.bridge?.adapter).toBe("appendix-c-adapter");
    expect(proof.bridge?.manifestId).toBe(manifest.id);
    expect(proof.bridge?.manifestVersion).toBe(manifest.manifestVersion);
    expect(proof.bridge?.manifestSchemaVersion).toBe(manifest.schemaVersion);
    expect(proof.bridge?.runtimeVersion).toBe(manifest.runtimeVersion);
    expect(proof.bridge?.proofDigest?.length).toBe(64);
    expect(proof.bridge?.publicInputsDigest?.length).toBe(64);

    const runtime = await pactZK.getBridgeRuntimeInfo();
    const manifests = await pactZK.listArtifactManifests("completion");
    const verified = await pactZK.verifyProof(proof.id);
    const receipts = await pactZK.getVerificationReceipts(proof.id);

    expect(runtime?.adapter).toBe("appendix-c-adapter");
    expect(runtime?.features.manifestVersioning).toBe(true);
    expect(manifests).toHaveLength(1);
    expect(manifests[0]?.manifestIntegrity).toBe(manifest.manifestIntegrity);
    expect(verified).toBe(true);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.proofId).toBe(proof.id);
    expect(receipts[0]?.manifestVersion).toBe(manifest.manifestVersion);
    expect(receipts[0]?.manifestIntegrity).toBe(manifest.manifestIntegrity);
    expect(receipts[0]?.verifier).toBe("appendix-c-adapter");
    expect(receipts[0]?.traceId.includes("verify")).toBe(true);
  });

  test("fails verification receipts when bridge traceability digests are tampered", async () => {
    const manifestRepository = new InMemoryZKArtifactManifestRepository();
    const proofRepository = new InMemoryZKProofRepository();
    const receiptRepository = new InMemoryZKVerificationReceiptRepository();
    await manifestRepository.save(createDefaultZKArtifactManifest("identity"));

    const bridge = new ProductionZKProverBridge(
      new DeterministicLocalZKProverAdapter("appendix-c-trace"),
      manifestRepository,
    );
    const pactZK = new PactZK(bridge, bridge, proofRepository, receiptRepository);

    const proof = await pactZK.generateIdentityProof("participant-1", {
      participantId: "participant-1",
      isHuman: true,
    });

    await proofRepository.save({
      ...proof,
      bridge: {
        ...proof.bridge!,
        proofDigest: "deadbeef",
      },
    });

    const verified = await pactZK.verifyProof(proof.id);
    const receipts = await pactZK.getVerificationReceipts(proof.id);

    expect(verified).toBe(false);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.details?.reason).toBe("proof_digest_mismatch");
    expect(receipts[0]?.details?.failureStage).toBe("bridge-trace");
  });

  test("rejects manifest circuit version mismatches", async () => {
    const manifestRepository = new InMemoryZKArtifactManifestRepository();
    const manifest = createDefaultZKArtifactManifest("location");
    await manifestRepository.save({
      ...manifest,
      circuit: {
        ...manifest.circuit,
        version: "9.9.9",
      },
    });

    const bridge = new ProductionZKProverBridge(new DeterministicLocalZKProverAdapter(), manifestRepository);

    await expect(
      bridge.generate(
        {
          type: "location",
          proverId: "worker-1",
          challenge: "challenge-1",
          publicInputs: {
            latitude: 12,
            longitude: 34,
            radius: 50,
            timestamp: 1_710_000_000_000,
          },
          createdAt: 1_710_000_000_000,
        },
        { witness: true },
      ),
    ).rejects.toThrow(AdapterOperationError);
  });

  test("rejects artifact integrity mismatches", async () => {
    const manifestRepository = new InMemoryZKArtifactManifestRepository();
    const manifest = createDefaultZKArtifactManifest("identity");
    await manifestRepository.save({
      ...manifest,
      artifacts: manifest.artifacts.map((artifact, index) => index === 0
        ? {
            ...artifact,
            integrity: "sha256:deadbeef",
          }
        : artifact),
    });

    const bridge = new ProductionZKProverBridge(new DeterministicLocalZKProverAdapter(), manifestRepository);

    await expect(
      bridge.generate(
        {
          type: "identity",
          proverId: "participant-1",
          challenge: "challenge-identity",
          publicInputs: {
            participantId: "participant-1",
            isHuman: true,
          },
          createdAt: 1_710_000_000_000,
        },
        { witness: true },
      ),
    ).rejects.toThrow(AdapterOperationError);
  });

  test("accepts binary artifact payloads without text-decoding integrity drift", async () => {
    const manifestRepository = new InMemoryZKArtifactManifestRepository();
    const binaryWasm = new Uint8Array([0xff, 0x00, 0x7f, 0x80, 0x41, 0x42]);
    const manifest = createDefaultZKArtifactManifest("identity");
    const binaryWasmIntegrity = await computeZKArtifactIntegrity(binaryWasm);
    const binaryManifest = {
      ...manifest,
      artifacts: manifest.artifacts.map((artifact, index) => index === 0
        ? {
            ...artifact,
            source: "remote" as const,
            bytes: binaryWasm.byteLength,
            integrity: binaryWasmIntegrity,
            inlineData: undefined,
          }
        : artifact),
    };
    await manifestRepository.save({
      ...binaryManifest,
      manifestIntegrity: await computeZKManifestIntegrity({
        id: binaryManifest.id,
        schemaVersion: binaryManifest.schemaVersion,
        proofType: binaryManifest.proofType,
        manifestVersion: binaryManifest.manifestVersion,
        runtimeVersion: binaryManifest.runtimeVersion,
        integrityAlgorithm: binaryManifest.integrityAlgorithm,
        circuit: binaryManifest.circuit,
        artifacts: binaryManifest.artifacts,
        createdAt: binaryManifest.createdAt,
        publishedAt: binaryManifest.publishedAt,
        artifactCount: binaryManifest.artifactCount,
      }),
    });

    const bridge = new ProductionZKProverBridge(
      new BinaryArtifactDeterministicAdapter(binaryWasm),
      manifestRepository,
    );

    await expect(
      bridge.generate(
        {
          type: "identity",
          proverId: "participant-binary",
          challenge: "binary-challenge",
          publicInputs: {
            participantId: "participant-binary",
            isHuman: true,
          },
          createdAt: 1_710_000_000_000,
        },
        { witness: true },
      ),
    ).resolves.toMatchObject({
      type: "identity",
      proverId: "participant-binary",
    });
  });

  test("reports degraded remote skeleton health until configured", async () => {
    const manifestRepository = new InMemoryZKArtifactManifestRepository();
    await manifestRepository.save(createDefaultZKArtifactManifest("reputation"));

    const bridge = new ProductionZKProverBridge(
      new RemoteHttpZKProverAdapterSkeleton({
        adapterName: "appendix-c-remote-skeleton",
      }),
      manifestRepository,
    );

    const health = await bridge.getHealth();
    const runtime = await bridge.getBridgeRuntimeInfo();

    expect(health.state).toBe("degraded");
    expect(health.features?.manifestCatalog).toBe(true);
    expect(runtime.features.remoteAdapterSkeleton).toBe(true);
  });

  test("reports healthy health when the full manifest catalog validates", async () => {
    const manifestRepository = new InMemoryZKArtifactManifestRepository();
    for (const manifest of createDefaultZKArtifactManifests()) {
      await manifestRepository.save(manifest);
    }

    const bridge = new ProductionZKProverBridge(
      new DeterministicLocalZKProverAdapter("appendix-c-health"),
      manifestRepository,
    );

    const health = await bridge.getHealth();

    expect(health.state).toBe("healthy");
    expect(health.features?.manifestCatalogState).toBe("healthy");
    expect(health.features?.manifestCount).toBe(4);
    expect(health.features?.activeManifestCount).toBe(4);
    expect(health.features?.validatedManifestCount).toBe(4);
    expect(health.features?.requiredManifestCount).toBe(4);
    expect(health.lastError).toBeUndefined();
  });

  test("reports unhealthy health when the manifest catalog is empty", async () => {
    const bridge = new ProductionZKProverBridge(
      new DeterministicLocalZKProverAdapter("appendix-c-health"),
      new InMemoryZKArtifactManifestRepository(),
    );

    const health = await bridge.getHealth();

    expect(health.state).toBe("unhealthy");
    expect(health.features?.manifestCatalogState).toBe("unhealthy");
    expect(health.features?.manifestCount).toBe(0);
    expect(health.features?.activeManifestCount).toBe(0);
    expect(health.features?.validatedManifestCount).toBe(0);
    expect(health.lastError?.code).toBe("zk_manifest_catalog_empty");
  });

  test("reports unhealthy health when the active manifest catalog contains invalid artifacts", async () => {
    const manifestRepository = new InMemoryZKArtifactManifestRepository();
    for (const manifest of createDefaultZKArtifactManifests()) {
      if (manifest.proofType !== "identity") {
        await manifestRepository.save(manifest);
        continue;
      }

      const corruptedManifest = {
        ...manifest,
        artifacts: manifest.artifacts.map((artifact, index) => index === 0
          ? {
              ...artifact,
              integrity: "sha256:corrupted",
            }
          : artifact),
      };

      await manifestRepository.save({
        ...corruptedManifest,
        manifestIntegrity: await computeZKManifestIntegrity({
          id: corruptedManifest.id,
          schemaVersion: corruptedManifest.schemaVersion,
          proofType: corruptedManifest.proofType,
          manifestVersion: corruptedManifest.manifestVersion,
          runtimeVersion: corruptedManifest.runtimeVersion,
          integrityAlgorithm: corruptedManifest.integrityAlgorithm,
          circuit: corruptedManifest.circuit,
          artifacts: corruptedManifest.artifacts,
          createdAt: corruptedManifest.createdAt,
          publishedAt: corruptedManifest.publishedAt,
          artifactCount: corruptedManifest.artifactCount,
        }),
      });
    }

    const bridge = new ProductionZKProverBridge(
      new DeterministicLocalZKProverAdapter("appendix-c-health"),
      manifestRepository,
    );

    const health = await bridge.getHealth();

    expect(health.state).toBe("unhealthy");
    expect(health.features?.manifestCatalogState).toBe("unhealthy");
    expect(health.features?.activeManifestCount).toBe(3);
    expect(health.features?.validatedManifestCount).toBe(2);
    expect(health.lastError?.code).toBe("zk_artifact_integrity_mismatch");
  });

  test("reports degraded health when active manifests are missing required proof types", async () => {
    const manifestRepository = new InMemoryZKArtifactManifestRepository();
    await manifestRepository.save(createDefaultZKArtifactManifest("location"));
    await manifestRepository.save(createDefaultZKArtifactManifest("completion"));

    const bridge = new ProductionZKProverBridge(
      new DeterministicLocalZKProverAdapter("appendix-c-health"),
      manifestRepository,
    );

    const health = await bridge.getHealth();

    expect(health.state).toBe("degraded");
    expect(health.features?.manifestCatalogState).toBe("degraded");
    expect(health.features?.activeManifestCount).toBe(2);
    expect(health.features?.validatedManifestCount).toBe(2);
    expect(health.lastError?.code).toBe("zk_manifest_missing");
    expect(health.lastError?.details?.proofType).toBe("identity");
  });
});

class BinaryArtifactDeterministicAdapter extends DeterministicLocalZKProverAdapter {
  constructor(private readonly binaryWasm: Uint8Array) {
    super("appendix-c-binary");
  }

  override async loadArtifact(artifact: Parameters<DeterministicLocalZKProverAdapter["loadArtifact"]>[0]) {
    if (artifact.role === "wasm") {
      return new Uint8Array(this.binaryWasm);
    }

    return await super.loadArtifact(artifact);
  }
}
