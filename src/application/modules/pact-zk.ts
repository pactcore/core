import { aggregateAdapterHealth, type AdapterHealthReport, type AdapterHealthSummary } from "../adapter-runtime";
import type {
  TraceableZKVerifier,
  ZKArtifactManifestCatalog,
  ZKBridgeRuntimeProvider,
  ZKProofRepository,
  ZKProver,
  ZKVerificationReceiptRepository,
  ZKVerifier,
} from "../contracts";
import { generateId } from "../utils";
import { getCircuitDefinition as getCircuitDefinitionByType, type CircuitDefinition } from "../../domain/zk-circuits";
import {
  verifyFormalSecurityProperties,
  type FormalProof,
} from "../../domain/zk-formal-verification";
import type { ZKArtifactManifest, ZKBridgeRuntimeInfo, ZKVerificationReceipt } from "../../domain/zk-bridge";
import type {
  ZKCompletionClaim,
  ZKIdentityClaim,
  ZKLocationClaim,
  ZKProof,
  ZKProofRequest,
  ZKProofType,
  ZKReputationClaim,
} from "../../domain/zk-proofs";

export interface FormalPropertyVerificationResult {
  proofId: string;
  proofType: ZKProofType;
  allSatisfied: boolean;
  properties: FormalProof[];
  checkedAt: number;
}

export class PactZK {
  constructor(
    private readonly prover: ZKProver,
    private readonly verifier: ZKVerifier,
    private readonly proofRepository: ZKProofRepository,
    private readonly verificationReceiptRepository?: ZKVerificationReceiptRepository,
  ) {}

  async generateLocationProof(proverId: string, claim: ZKLocationClaim): Promise<ZKProof> {
    return this.generateProof("location", proverId, { ...claim }, claim);
  }

  async generateCompletionProof(proverId: string, claim: ZKCompletionClaim): Promise<ZKProof> {
    return this.generateProof("completion", proverId, { ...claim }, claim);
  }

  async generateIdentityProof(proverId: string, claim: ZKIdentityClaim): Promise<ZKProof> {
    return this.generateProof("identity", proverId, { ...claim }, claim);
  }

  async generateReputationProof(proverId: string, claim: ZKReputationClaim): Promise<ZKProof> {
    return this.generateProof("reputation", proverId, { ...claim }, claim);
  }

  async verifyProof(proofId: string): Promise<boolean> {
    const proof = await this.proofRepository.getById(proofId);
    if (!proof) {
      return false;
    }

    const receipt = this.isTraceableVerifier(this.verifier)
      ? await this.verifier.verifyWithReceipt(proof)
      : undefined;
    const verified = receipt?.verified ?? (await this.verifier.verify(proof));

    if (receipt && this.verificationReceiptRepository) {
      await this.verificationReceiptRepository.save(receipt);
    }

    await this.proofRepository.save({
      ...proof,
      verified,
    });

    return verified;
  }

  async getProof(proofId: string): Promise<ZKProof | undefined> {
    return this.proofRepository.getById(proofId);
  }

  async listProofsByProver(proverId: string): Promise<ZKProof[]> {
    return this.proofRepository.getByProver(proverId);
  }

  async getVerificationReceipts(proofId: string): Promise<ZKVerificationReceipt[]> {
    return this.verificationReceiptRepository?.listByProofId(proofId) ?? [];
  }

  async getAdapterHealth(): Promise<AdapterHealthSummary> {
    const adapters = [this.prover, this.verifier]
      .filter((adapter, index, list) => list.indexOf(adapter) === index)
      .filter(this.hasHealth);

    const reports = await Promise.all(adapters.map((adapter) => adapter.getHealth()));
    return aggregateAdapterHealth(reports);
  }

  async getBridgeRuntimeInfo(): Promise<ZKBridgeRuntimeInfo | undefined> {
    const bridge = this.asBridgeRuntimeProvider(this.prover) ?? this.asBridgeRuntimeProvider(this.verifier);
    return bridge?.getBridgeRuntimeInfo();
  }

  async getArtifactManifest(type: ZKProofType, manifestVersion?: string): Promise<ZKArtifactManifest | undefined> {
    const catalog = this.asManifestCatalog(this.prover) ?? this.asManifestCatalog(this.verifier);
    return catalog?.getArtifactManifest(type, manifestVersion);
  }

  async listArtifactManifests(type?: ZKProofType): Promise<ZKArtifactManifest[]> {
    const catalog = this.asManifestCatalog(this.prover) ?? this.asManifestCatalog(this.verifier);
    return catalog?.listArtifactManifests(type) ?? [];
  }

  getCircuitDefinition(proofType: ZKProofType): CircuitDefinition {
    return getCircuitDefinitionByType(proofType);
  }

  async verifyFormalProperties(proofId: string): Promise<FormalPropertyVerificationResult | undefined> {
    const proof = await this.proofRepository.getById(proofId);
    if (!proof) {
      return undefined;
    }

    const circuit = this.getCircuitDefinition(proof.type);
    const verification = verifyFormalSecurityProperties(circuit, proof.publicInputs, {
      commitment: proof.commitment,
      proof: proof.proof,
    });

    return {
      proofId: proof.id,
      proofType: proof.type,
      allSatisfied: verification.verified,
      properties: verification.proofs,
      checkedAt: verification.checkedAt,
    };
  }

  private async generateProof(
    type: ZKProofType,
    proverId: string,
    publicInputsSource: Record<string, unknown>,
    witness: unknown,
  ): Promise<ZKProof> {
    const publicInputs = { ...publicInputsSource };
    const request: ZKProofRequest = {
      type,
      proverId,
      challenge: generateId("challenge"),
      publicInputs,
      createdAt: Date.now(),
    };

    const proof = await this.prover.generate(request, witness);
    await this.proofRepository.save(proof);
    return proof;
  }

  private isTraceableVerifier(verifier: ZKVerifier): verifier is TraceableZKVerifier {
    return "verifyWithReceipt" in verifier;
  }

  private hasHealth(adapter: unknown): adapter is { getHealth: () => Promise<AdapterHealthReport> | AdapterHealthReport } {
    return typeof adapter === "object" && adapter !== null && "getHealth" in adapter && typeof adapter.getHealth === "function";
  }

  private asBridgeRuntimeProvider(adapter: unknown): ZKBridgeRuntimeProvider | undefined {
    return typeof adapter === "object" && adapter !== null && "getBridgeRuntimeInfo" in adapter
      ? adapter as ZKBridgeRuntimeProvider
      : undefined;
  }

  private asManifestCatalog(adapter: unknown): ZKArtifactManifestCatalog | undefined {
    return typeof adapter === "object" && adapter !== null && "listArtifactManifests" in adapter
      ? adapter as ZKArtifactManifestCatalog
      : undefined;
  }
}
