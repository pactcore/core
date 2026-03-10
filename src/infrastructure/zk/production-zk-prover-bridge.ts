import { AdapterOperationError, type AdapterHealthReport } from "../../application/adapter-runtime";
import type {
  ExternalZKProverAdapter,
  TraceableZKVerifier,
  ZKArtifactManifestRepository,
  ZKProver,
} from "../../application/contracts";
import { generateId } from "../../application/utils";
import {
  computeZKArtifactIntegrity,
  computeZKManifestIntegrity,
  hashZKBridgePayload,
  type ZKArtifactDescriptor,
  type ZKArtifactManifest,
  type ZKVerificationReceipt,
} from "../../domain/zk-bridge";
import { getCircuitDefinition } from "../../domain/zk-circuits";
import type { ZKProof, ZKProofRequest } from "../../domain/zk-proofs";

export interface ProductionZKProverBridgeOptions {
  runtimeVersion?: string;
  adapterName?: string;
}

export class ProductionZKProverBridge implements ZKProver, TraceableZKVerifier {
  private readonly runtimeVersion: string;
  private readonly adapterName: string;

  constructor(
    private readonly adapter: ExternalZKProverAdapter,
    private readonly manifestRepository: ZKArtifactManifestRepository,
    options: ProductionZKProverBridgeOptions = {},
  ) {
    this.runtimeVersion = options.runtimeVersion ?? "0.2.0";
    this.adapterName = options.adapterName ?? adapter.adapterName ?? "external-zk-prover-adapter";
  }

  async generate(request: ZKProofRequest, witness: unknown): Promise<ZKProof> {
    const manifest = await this.requireManifest(request.type, request.manifestVersion);
    await this.validateManifest(manifest, request.type);

    const traceId = request.traceId ?? generateId("zk_trace");
    const response = await this.adapter.prove({
      requestId: generateId("zk_req"),
      traceId,
      proofType: request.type,
      proverId: request.proverId,
      challenge: request.challenge,
      publicInputs: request.publicInputs,
      witness,
      createdAt: request.createdAt,
      manifest,
    });

    const proofDigest = await this.computeProofDigest({
      type: request.type,
      proverId: request.proverId,
      commitment: response.commitment,
      publicInputs: request.publicInputs,
      proof: response.proof,
      createdAt: request.createdAt,
    });

    return {
      id: generateId("zkp"),
      type: request.type,
      proverId: request.proverId,
      commitment: response.commitment,
      publicInputs: structuredClone(request.publicInputs),
      proof: response.proof,
      verified: false,
      createdAt: request.createdAt,
      bridge: {
        adapter: this.adapterName,
        manifestId: manifest.id,
        manifestVersion: manifest.manifestVersion,
        manifestIntegrity: manifest.manifestIntegrity,
        traceId: response.traceId ?? traceId,
        proofDigest,
        adapterReceiptId: response.adapterReceiptId,
      },
    };
  }

  async verify(proof: ZKProof): Promise<boolean> {
    const receipt = await this.verifyWithReceipt(proof);
    return receipt.verified;
  }

  async verifyWithReceipt(proof: ZKProof): Promise<ZKVerificationReceipt> {
    const manifest = await this.requireManifest(proof.type, proof.bridge?.manifestVersion);
    await this.validateManifest(manifest, proof.type);

    const traceId = proof.bridge?.traceId ?? generateId("zk_trace");
    const response = await this.adapter.verify({
      traceId,
      proofId: proof.id,
      proofType: proof.type,
      proverId: proof.proverId,
      commitment: proof.commitment,
      proof: proof.proof,
      publicInputs: proof.publicInputs,
      createdAt: proof.createdAt,
      manifest,
    });

    return {
      id: generateId("zkvr"),
      proofId: proof.id,
      proofType: proof.type,
      verified: response.verified,
      verifier: this.adapterName,
      manifestId: manifest.id,
      manifestVersion: manifest.manifestVersion,
      manifestIntegrity: manifest.manifestIntegrity,
      proofDigest: await this.computeProofDigest(proof),
      publicInputsDigest: await hashZKBridgePayload(proof.publicInputs),
      traceId: response.traceId ?? traceId,
      adapterReceiptId: response.adapterReceiptId,
      details: response.details,
      checkedAt: Date.now(),
    };
  }

  async getHealth(): Promise<AdapterHealthReport> {
    const adapterHealth = await this.adapter.getHealth?.();
    return {
      name: "zk-prover-bridge",
      state: adapterHealth?.state ?? "healthy",
      checkedAt: Date.now(),
      durable: adapterHealth?.durable ?? true,
      durability: adapterHealth?.durability ?? this.adapter.durability ?? "remote",
      features: {
        externalProver: true,
        artifactManifestChecks: true,
        verificationReceipts: true,
      },
      compatibility: {
        compatible: true,
        currentVersion: this.runtimeVersion,
        supportedVersions: [this.runtimeVersion],
      },
      lastError: adapterHealth?.lastError,
    };
  }

  private async requireManifest(type: ZKProofRequest["type"], manifestVersion?: string): Promise<ZKArtifactManifest> {
    const manifest = await this.manifestRepository.getByType(type, manifestVersion);
    if (!manifest) {
      throw new AdapterOperationError(`Missing ZK artifact manifest for ${type}`, {
        adapter: "zk",
        operation: "resolve_artifact_manifest",
        code: "zk_manifest_missing",
        retryable: false,
      });
    }

    return manifest;
  }

  private async validateManifest(manifest: ZKArtifactManifest, type: ZKProofRequest["type"]): Promise<void> {
    const circuit = getCircuitDefinition(type);

    if (manifest.proofType !== type) {
      throw new AdapterOperationError(`Manifest proof type mismatch for ${type}`, {
        adapter: "zk",
        operation: "validate_artifact_manifest",
        code: "zk_manifest_type_mismatch",
        retryable: false,
      });
    }

    if (manifest.runtimeVersion !== this.runtimeVersion) {
      throw new AdapterOperationError(`Manifest runtime version ${manifest.runtimeVersion} is incompatible`, {
        adapter: "zk",
        operation: "validate_artifact_manifest",
        code: "zk_manifest_runtime_mismatch",
        retryable: false,
        details: {
          expectedRuntimeVersion: this.runtimeVersion,
        },
      });
    }

    if (
      manifest.circuit.name !== circuit.name ||
      manifest.circuit.version !== circuit.version ||
      manifest.circuit.provingSystem !== circuit.provingSystem
    ) {
      throw new AdapterOperationError(`Manifest circuit version mismatch for ${type}`, {
        adapter: "zk",
        operation: "validate_artifact_manifest",
        code: "zk_manifest_circuit_mismatch",
        retryable: false,
        details: {
          expectedCircuitVersion: circuit.version,
          receivedCircuitVersion: manifest.circuit.version,
        },
      });
    }

    const computedManifestIntegrity = await computeZKManifestIntegrity({
      id: manifest.id,
      proofType: manifest.proofType,
      manifestVersion: manifest.manifestVersion,
      runtimeVersion: manifest.runtimeVersion,
      circuit: manifest.circuit,
      artifacts: manifest.artifacts,
      createdAt: manifest.createdAt,
    });

    if (computedManifestIntegrity !== manifest.manifestIntegrity) {
      throw new AdapterOperationError(`Manifest integrity mismatch for ${type}`, {
        adapter: "zk",
        operation: "validate_artifact_manifest",
        code: "zk_manifest_integrity_mismatch",
        retryable: false,
      });
    }

    for (const artifact of manifest.artifacts) {
      await this.validateArtifact(artifact);
    }
  }

  private async validateArtifact(artifact: ZKArtifactDescriptor): Promise<void> {
    const inlineData = artifact.inlineData ?? (await this.loadArtifactData(artifact));
    const computedIntegrity = await computeZKArtifactIntegrity(inlineData);

    if (computedIntegrity !== artifact.integrity) {
      throw new AdapterOperationError(`Artifact integrity mismatch for ${artifact.role}`, {
        adapter: "zk",
        operation: "validate_artifact_integrity",
        code: "zk_artifact_integrity_mismatch",
        retryable: false,
        details: {
          role: artifact.role,
          uri: artifact.uri,
        },
      });
    }
  }

  private async loadArtifactData(artifact: ZKArtifactDescriptor): Promise<string> {
    const data = await this.adapter.loadArtifact?.(artifact);
    if (typeof data === "string") {
      return data;
    }
    if (data instanceof Uint8Array) {
      return new TextDecoder().decode(data);
    }

    throw new AdapterOperationError(`Artifact ${artifact.uri} is not locally resolvable`, {
      adapter: "zk",
      operation: "load_artifact",
      code: "zk_artifact_unavailable",
      retryable: true,
      details: {
        role: artifact.role,
        uri: artifact.uri,
      },
    });
  }

  private async computeProofDigest(proof: Pick<ZKProof, "type" | "proverId" | "commitment" | "publicInputs" | "proof" | "createdAt">): Promise<string> {
    return hashZKBridgePayload({
      type: proof.type,
      proverId: proof.proverId,
      commitment: proof.commitment,
      publicInputs: proof.publicInputs,
      proof: proof.proof,
      createdAt: proof.createdAt,
    });
  }
}
