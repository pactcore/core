import { describe, expect, test } from "bun:test";
import { AdapterOperationError } from "../src/application/adapter-runtime";
import { PactZK } from "../src/application/modules/pact-zk";
import {
  computeZKArtifactIntegrity,
  computeZKManifestIntegrity,
  getCircuitDefinition,
  type ZKArtifactManifest,
  type ZKProofType,
} from "../src/index";
import { InMemoryZKArtifactManifestRepository } from "../src/infrastructure/zk/in-memory-zk-artifact-manifest-repository";
import { InMemoryZKProofRepository } from "../src/infrastructure/zk/in-memory-zk-proof-repository";
import { InMemoryZKVerificationReceiptRepository } from "../src/infrastructure/zk/in-memory-zk-verification-receipt-repository";
import { MockExternalZKProverAdapter } from "../src/infrastructure/zk/mock-external-zk-prover-adapter";
import { ProductionZKProverBridge } from "../src/infrastructure/zk/production-zk-prover-bridge";

describe("ProductionZKProverBridge", () => {
  test("generates bridge metadata and verification receipts", async () => {
    const manifestRepository = new InMemoryZKArtifactManifestRepository();
    const receiptRepository = new InMemoryZKVerificationReceiptRepository();
    const manifest = await createManifest("completion");
    await manifestRepository.save(manifest);

    const bridge = new ProductionZKProverBridge(
      new MockExternalZKProverAdapter("appendix-c-adapter"),
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
    expect(proof.bridge?.proofDigest.length).toBe(64);

    const verified = await pactZK.verifyProof(proof.id);
    const receipts = await pactZK.getVerificationReceipts(proof.id);

    expect(verified).toBe(true);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.proofId).toBe(proof.id);
    expect(receipts[0]?.manifestVersion).toBe(manifest.manifestVersion);
    expect(receipts[0]?.verifier).toBe("appendix-c-adapter");
    expect(receipts[0]?.traceId.includes("verify")).toBe(true);
  });

  test("rejects manifest circuit version mismatches", async () => {
    const manifestRepository = new InMemoryZKArtifactManifestRepository();
    await manifestRepository.save(
      await createManifest("location", {
        circuit: {
          name: "PACT.LocationInRadius",
          version: "9.9.9",
          provingSystem: "groth16",
        },
      }),
    );

    const bridge = new ProductionZKProverBridge(new MockExternalZKProverAdapter(), manifestRepository);

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
    await manifestRepository.save(
      await createManifest("identity", {
        artifacts: [
          {
            role: "wasm",
            uri: "memory://identity/wasm",
            version: "1.0.0",
            integrity: "sha256:deadbeef",
            inlineData: "identity-wasm-binary",
          },
          {
            role: "verification-key",
            uri: "memory://identity/vkey",
            version: "1.0.0",
            integrity: await computeZKArtifactIntegrity("identity-verification-key"),
            inlineData: "identity-verification-key",
          },
        ],
      }),
    );

    const bridge = new ProductionZKProverBridge(new MockExternalZKProverAdapter(), manifestRepository);

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
});

async function createManifest(
  proofType: ZKProofType,
  overrides: Partial<ZKArtifactManifest> = {},
): Promise<ZKArtifactManifest> {
  const circuit = getCircuitDefinition(proofType);
  const artifacts = overrides.artifacts ?? [
    {
      role: "wasm",
      uri: `memory://${proofType}/circuit.wasm`,
      version: "1.0.0",
      integrity: await computeZKArtifactIntegrity(`${proofType}-wasm-binary`),
      inlineData: `${proofType}-wasm-binary`,
    },
    {
      role: "proving-key",
      uri: `memory://${proofType}/proving.key`,
      version: "1.0.0",
      integrity: await computeZKArtifactIntegrity(`${proofType}-proving-key`),
      inlineData: `${proofType}-proving-key`,
    },
    {
      role: "verification-key",
      uri: `memory://${proofType}/verification.key`,
      version: "1.0.0",
      integrity: await computeZKArtifactIntegrity(`${proofType}-verification-key`),
      inlineData: `${proofType}-verification-key`,
    },
  ];
  const manifestWithoutIntegrity = {
    id: overrides.id ?? `manifest-${proofType}`,
    proofType,
    manifestVersion: overrides.manifestVersion ?? "1.0.0",
    runtimeVersion: overrides.runtimeVersion ?? "0.2.0",
    circuit: overrides.circuit ?? {
      name: circuit.name,
      version: circuit.version,
      provingSystem: circuit.provingSystem,
    },
    artifacts,
    createdAt: overrides.createdAt ?? 1_710_000_000_000,
  };

  return {
    ...manifestWithoutIntegrity,
    manifestIntegrity:
      overrides.manifestIntegrity ?? (await computeZKManifestIntegrity(manifestWithoutIntegrity)),
  };
}
