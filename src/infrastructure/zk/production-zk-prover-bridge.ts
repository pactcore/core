import { AdapterOperationError, type AdapterHealthReport, type AdapterHealthState } from "../../application/adapter-runtime";
import type {
  ExternalZKProverAdapter,
  ZKProverBridge,
  ZKVerifierBridge,
  ZKArtifactManifestRepository,
} from "../../application/contracts";
import { generateId } from "../../application/utils";
import {
  computeZKArtifactIntegrity,
  computeZKManifestIntegrity,
  hashZKBridgePayload,
  type ZKArtifactDescriptor,
  type ZKArtifactManifest,
  type ZKBridgeRuntimeInfo,
  type ZKVerificationReceipt,
} from "../../domain/zk-bridge";
import { getCircuitDefinition } from "../../domain/zk-circuits";
import type { ZKProof, ZKProofRequest, ZKProofType } from "../../domain/zk-proofs";

const REQUIRED_PROOF_TYPES: ZKProofType[] = ["location", "completion", "identity", "reputation"];

export interface ProductionZKProverBridgeOptions {
  runtimeVersion?: string;
  adapterName?: string;
}

export class ProductionZKProverBridge implements ZKProverBridge, ZKVerifierBridge {
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
    await this.validateManifest(manifest, request.type, "prove");

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
    const publicInputsDigest = await hashZKBridgePayload(request.publicInputs);

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
        manifestSchemaVersion: manifest.schemaVersion,
        runtimeVersion: manifest.runtimeVersion,
        traceId: response.traceId ?? traceId,
        proofDigest,
        publicInputsDigest,
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
    await this.validateManifest(manifest, proof.type, "verify");

    const computedProofDigest = await this.computeProofDigest(proof);
    const publicInputsDigest = await hashZKBridgePayload(proof.publicInputs);
    const traceCheckFailure = this.getTraceCheckFailure(proof, manifest, computedProofDigest, publicInputsDigest);

    if (traceCheckFailure) {
      return this.createReceipt({
        proof,
        manifest,
        verified: false,
        proofDigest: computedProofDigest,
        publicInputsDigest,
        traceId: proof.bridge?.traceId ?? generateId("zk_trace"),
        adapterReceiptId: proof.bridge?.adapterReceiptId,
        details: traceCheckFailure,
      });
    }

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

    return this.createReceipt({
      proof,
      manifest,
      verified: response.verified,
      proofDigest: computedProofDigest,
      publicInputsDigest,
      traceId: response.traceId ?? traceId,
      adapterReceiptId: response.adapterReceiptId,
      details: response.details,
    });
  }

  async getArtifactManifest(type: ZKProofRequest["type"], manifestVersion?: string): Promise<ZKArtifactManifest | undefined> {
    return this.manifestRepository.getByType(type, manifestVersion);
  }

  async listArtifactManifests(type?: ZKProofRequest["type"]): Promise<ZKArtifactManifest[]> {
    return this.manifestRepository.listByType(type);
  }

  async getBridgeRuntimeInfo(): Promise<ZKBridgeRuntimeInfo> {
    const manifests = await this.manifestRepository.listByType();
    const manifestsByType: ZKBridgeRuntimeInfo["manifestCatalog"]["manifestsByType"] = {};
    const schemaVersions = new Set<string>();

    for (const manifest of manifests) {
      if (manifest.schemaVersion) {
        schemaVersions.add(manifest.schemaVersion);
      }
      manifestsByType[manifest.proofType] = [
        ...(manifestsByType[manifest.proofType] ?? []),
        manifest.manifestVersion,
      ];
    }

    return {
      adapter: this.adapterName,
      runtimeVersion: this.runtimeVersion,
      durability: this.adapter.durability ?? "unknown",
      manifestCatalog: {
        schemaVersions: [...schemaVersions].sort(),
        manifestsByType,
      },
      features: {
        manifestVersioning: true,
        artifactIntegrity: true,
        receiptTraceability: true,
        deterministicLocalAdapter: this.adapter.durability === "memory",
        remoteAdapterSkeleton: this.adapter.adapterName?.includes("skeleton") ?? false,
      },
    };
  }

  async getHealth(): Promise<AdapterHealthReport> {
    const adapterHealth = await this.adapter.getHealth?.();
    const runtime = await this.getBridgeRuntimeInfo();
    const manifestHealth = await this.evaluateManifestCatalogHealth();

    return {
      name: "zk-prover-bridge",
      state: this.mergeHealthState(adapterHealth?.state ?? "healthy", manifestHealth.state),
      checkedAt: Date.now(),
      durable: adapterHealth?.durable ?? true,
      durability: adapterHealth?.durability ?? this.adapter.durability ?? "remote",
      features: {
        ...(adapterHealth?.features ?? {}),
        externalProver: true,
        artifactManifestChecks: true,
        verificationReceipts: true,
        manifestCatalog: true,
        bridgeAdapter: this.adapterName,
        manifestSchemas: runtime.manifestCatalog.schemaVersions.join(",") || "none",
        manifestCatalogState: manifestHealth.state,
        manifestCount: manifestHealth.manifestCount,
        activeManifestCount: manifestHealth.activeManifestCount,
        validatedManifestCount: manifestHealth.validatedManifestCount,
        requiredManifestCount: REQUIRED_PROOF_TYPES.length,
      },
      compatibility: {
        compatible: true,
        currentVersion: this.runtimeVersion,
        supportedVersions: [this.runtimeVersion],
      },
      lastError: this.selectHealthError(adapterHealth, manifestHealth),
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

  private async validateManifest(
    manifest: ZKArtifactManifest,
    type: ZKProofRequest["type"],
    mode: "prove" | "verify",
  ): Promise<void> {
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

    if ((manifest.integrityAlgorithm ?? "sha256") !== "sha256") {
      throw new AdapterOperationError(`Unsupported manifest integrity algorithm for ${type}`, {
        adapter: "zk",
        operation: "validate_artifact_manifest",
        code: "zk_manifest_integrity_algorithm_unsupported",
        retryable: false,
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
      schemaVersion: manifest.schemaVersion,
      proofType: manifest.proofType,
      manifestVersion: manifest.manifestVersion,
      runtimeVersion: manifest.runtimeVersion,
      integrityAlgorithm: manifest.integrityAlgorithm,
      circuit: manifest.circuit,
      artifacts: manifest.artifacts,
      createdAt: manifest.createdAt,
      publishedAt: manifest.publishedAt,
      artifactCount: manifest.artifactCount,
    });

    if (computedManifestIntegrity !== manifest.manifestIntegrity) {
      throw new AdapterOperationError(`Manifest integrity mismatch for ${type}`, {
        adapter: "zk",
        operation: "validate_artifact_manifest",
        code: "zk_manifest_integrity_mismatch",
        retryable: false,
      });
    }

    if (manifest.artifactCount !== undefined && manifest.artifactCount !== manifest.artifacts.length) {
      throw new AdapterOperationError(`Manifest artifact count mismatch for ${type}`, {
        adapter: "zk",
        operation: "validate_artifact_manifest",
        code: "zk_manifest_artifact_count_mismatch",
        retryable: false,
      });
    }

    this.validateRequiredArtifactRoles(manifest, mode);

    for (const artifact of manifest.artifacts) {
      await this.validateArtifact(artifact);
    }
  }

  private validateRequiredArtifactRoles(manifest: ZKArtifactManifest, mode: "prove" | "verify") {
    const roles = new Set(manifest.artifacts.map((artifact) => artifact.role));
    const requiredRoles = mode === "prove"
      ? (["wasm", "proving-key", "verification-key"] satisfies ZKArtifactDescriptor["role"][])
      : (["verification-key"] satisfies ZKArtifactDescriptor["role"][]);

    for (const role of requiredRoles) {
      if (!roles.has(role)) {
        throw new AdapterOperationError(`Manifest is missing ${role} for ${mode}`, {
          adapter: "zk",
          operation: "validate_artifact_manifest",
          code: "zk_manifest_required_artifact_missing",
          retryable: false,
          details: {
            role,
            mode,
          },
        });
      }
    }
  }

  private async validateArtifact(artifact: ZKArtifactDescriptor): Promise<void> {
    if ((artifact.integrityAlgorithm ?? "sha256") !== "sha256") {
      throw new AdapterOperationError(`Unsupported integrity algorithm for ${artifact.role}`, {
        adapter: "zk",
        operation: "validate_artifact_integrity",
        code: "zk_artifact_integrity_algorithm_unsupported",
        retryable: false,
        details: {
          role: artifact.role,
        },
      });
    }

    const inlineData = artifact.inlineData ?? (await this.loadArtifactData(artifact));
    const computedIntegrity = await computeZKArtifactIntegrity(inlineData);

    if (artifact.bytes !== undefined && new TextEncoder().encode(inlineData).byteLength !== artifact.bytes) {
      throw new AdapterOperationError(`Artifact byte length mismatch for ${artifact.role}`, {
        adapter: "zk",
        operation: "validate_artifact_integrity",
        code: "zk_artifact_size_mismatch",
        retryable: false,
        details: {
          role: artifact.role,
          uri: artifact.uri,
        },
      });
    }

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

  private getTraceCheckFailure(
    proof: ZKProof,
    manifest: ZKArtifactManifest,
    proofDigest: string,
    publicInputsDigest: string,
  ): Record<string, string> | undefined {
    if (!proof.bridge) {
      return {
        failureStage: "bridge-trace",
        reason: "missing_bridge_metadata",
      };
    }

    if (proof.bridge.manifestId !== manifest.id) {
      return {
        failureStage: "bridge-trace",
        reason: "manifest_id_mismatch",
        expectedManifestId: manifest.id,
        receivedManifestId: proof.bridge.manifestId,
      };
    }

    if (proof.bridge.manifestIntegrity !== manifest.manifestIntegrity) {
      return {
        failureStage: "bridge-trace",
        reason: "manifest_integrity_mismatch",
        expectedManifestIntegrity: manifest.manifestIntegrity,
        receivedManifestIntegrity: proof.bridge.manifestIntegrity,
      };
    }

    if (proof.bridge.proofDigest !== proofDigest) {
      return {
        failureStage: "bridge-trace",
        reason: "proof_digest_mismatch",
        expectedProofDigest: proofDigest,
        receivedProofDigest: proof.bridge.proofDigest,
      };
    }

    if (proof.bridge.publicInputsDigest && proof.bridge.publicInputsDigest !== publicInputsDigest) {
      return {
        failureStage: "bridge-trace",
        reason: "public_inputs_digest_mismatch",
        expectedPublicInputsDigest: publicInputsDigest,
        receivedPublicInputsDigest: proof.bridge.publicInputsDigest,
      };
    }

    return undefined;
  }

  private createReceipt(input: {
    proof: ZKProof;
    manifest: ZKArtifactManifest;
    verified: boolean;
    proofDigest: string;
    publicInputsDigest: string;
    traceId: string;
    adapterReceiptId?: string;
    details?: Record<string, string>;
  }): ZKVerificationReceipt {
    return {
      id: generateId("zkvr"),
      proofId: input.proof.id,
      proofType: input.proof.type,
      verified: input.verified,
      verifier: this.adapterName,
      manifestId: input.manifest.id,
      manifestVersion: input.manifest.manifestVersion,
      manifestIntegrity: input.manifest.manifestIntegrity,
      proofDigest: input.proofDigest,
      publicInputsDigest: input.publicInputsDigest,
      traceId: input.traceId,
      adapterReceiptId: input.adapterReceiptId,
      details: input.details,
      checkedAt: Date.now(),
    };
  }

  private async computeProofDigest(
    proof: Pick<ZKProof, "type" | "proverId" | "commitment" | "publicInputs" | "proof" | "createdAt">,
  ): Promise<string> {
    return hashZKBridgePayload({
      type: proof.type,
      proverId: proof.proverId,
      commitment: proof.commitment,
      publicInputs: proof.publicInputs,
      proof: proof.proof,
      createdAt: proof.createdAt,
    });
  }

  private async evaluateManifestCatalogHealth(): Promise<{
    state: AdapterHealthState;
    manifestCount: number;
    activeManifestCount: number;
    validatedManifestCount: number;
    lastError?: AdapterHealthReport["lastError"];
  }> {
    const manifests = await this.manifestRepository.listByType();
    let activeManifestCount = 0;
    let validatedManifestCount = 0;

    if (manifests.length === 0) {
      const error = new AdapterOperationError("No ZK artifact manifests configured", {
        adapter: "zk",
        operation: "validate_artifact_manifest",
        code: "zk_manifest_catalog_empty",
        retryable: false,
      });
      return {
        state: "unhealthy",
        manifestCount: 0,
        activeManifestCount: 0,
        validatedManifestCount: 0,
        lastError: error.toDescriptor(),
      };
    }

    for (const proofType of REQUIRED_PROOF_TYPES) {
      const manifest = await this.manifestRepository.getByType(proofType);
      if (!manifest) {
        const error = new AdapterOperationError(`Missing active ZK artifact manifest for ${proofType}`, {
          adapter: "zk",
          operation: "validate_artifact_manifest",
          code: "zk_manifest_missing",
          retryable: false,
          details: {
            proofType,
          },
        });
        return {
          state: "degraded",
          manifestCount: manifests.length,
          activeManifestCount,
          validatedManifestCount,
          lastError: error.toDescriptor(),
        };
      }

      activeManifestCount += 1;

      try {
        await this.validateManifest(manifest, proofType, "prove");
        validatedManifestCount += 1;
      } catch (error) {
        const normalized = error instanceof AdapterOperationError
          ? error
          : new AdapterOperationError(
              error instanceof Error ? error.message : String(error),
              {
                adapter: "zk",
                operation: "validate_artifact_manifest",
                code: "zk_manifest_validation_failed",
                retryable: false,
                details: {
                  proofType,
                },
                cause: error,
              },
            );

        return {
          state: "unhealthy",
          manifestCount: manifests.length,
          activeManifestCount,
          validatedManifestCount,
          lastError: normalized.toDescriptor(),
        };
      }
    }

    return {
      state: "healthy",
      manifestCount: manifests.length,
      activeManifestCount,
      validatedManifestCount,
    };
  }

  private mergeHealthState(
    left: AdapterHealthState,
    right: AdapterHealthState,
  ): AdapterHealthState {
    const severity: Record<AdapterHealthState, number> = {
      healthy: 0,
      degraded: 1,
      unhealthy: 2,
    };

    return severity[left] >= severity[right] ? left : right;
  }

  private selectHealthError(
    adapterHealth: AdapterHealthReport | undefined,
    manifestHealth: {
      state: AdapterHealthState;
      lastError?: AdapterHealthReport["lastError"];
    },
  ): AdapterHealthReport["lastError"] {
    if (manifestHealth.state === "unhealthy" && manifestHealth.lastError) {
      return manifestHealth.lastError;
    }

    if (adapterHealth?.state === "unhealthy" && adapterHealth.lastError) {
      return adapterHealth.lastError;
    }

    if (manifestHealth.state === "degraded" && manifestHealth.lastError) {
      return manifestHealth.lastError;
    }

    return adapterHealth?.lastError;
  }
}
