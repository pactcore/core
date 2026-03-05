import type {
  DataAccessPolicyRepository,
  DataAssetRepository,
  IntegrityProofRepository,
  ProvenanceGraph,
} from "../contracts";
import type { DataAccessPolicy, IntegrityProof } from "../../domain/types";
import { generateId } from "../utils";

export interface DataAsset {
  id: string;
  ownerId: string;
  title: string;
  uri: string;
  tags: string[];
  createdAt: number;
}

export interface PublishDataAssetInput {
  ownerId: string;
  title: string;
  uri: string;
  tags?: string[];
  derivedFrom?: string[];
}

export class PactData {
  constructor(
    private readonly assetRepository: DataAssetRepository,
    private readonly provenanceGraph: ProvenanceGraph,
    private readonly integrityProofRepository: IntegrityProofRepository,
    private readonly accessPolicyRepository: DataAccessPolicyRepository,
  ) {}

  // ── Asset publishing ───────────────────────────────────────

  async publish(input: PublishDataAssetInput): Promise<DataAsset> {
    const asset: DataAsset = {
      id: generateId("data"),
      ownerId: input.ownerId,
      title: input.title,
      uri: input.uri,
      tags: input.tags ?? [],
      createdAt: Date.now(),
    };

    await this.assetRepository.save(asset);

    // Auto-create provenance edges
    if (input.derivedFrom) {
      for (const parentId of input.derivedFrom) {
        await this.provenanceGraph.addEdge({
          childId: asset.id,
          parentId,
          relationship: "derived_from",
          createdAt: Date.now(),
        });
      }
    }

    // Default access policy: public
    await this.accessPolicyRepository.save({
      assetId: asset.id,
      allowedParticipantIds: [input.ownerId],
      isPublic: true,
    });

    return asset;
  }

  async list(): Promise<DataAsset[]> {
    return this.assetRepository.list();
  }

  async getById(id: string): Promise<DataAsset | undefined> {
    return this.assetRepository.getById(id);
  }

  // ── Provenance ─────────────────────────────────────────────

  async getLineage(assetId: string) {
    return this.provenanceGraph.getLineage(assetId);
  }

  async getDependents(assetId: string) {
    return this.provenanceGraph.getDependents(assetId);
  }

  // ── Integrity proofs ───────────────────────────────────────

  async registerIntegrityProof(assetId: string, contentHash: string): Promise<IntegrityProof> {
    const proof: IntegrityProof = {
      assetId,
      algorithm: "sha-256",
      hash: contentHash,
      provenAt: Date.now(),
    };
    await this.integrityProofRepository.save(proof);
    return proof;
  }

  async verifyIntegrity(assetId: string, contentHash: string): Promise<boolean> {
    const proof = await this.integrityProofRepository.getByAsset(assetId);
    if (!proof) return false;
    return proof.hash === contentHash;
  }

  // ── Access control ─────────────────────────────────────────

  async setAccessPolicy(
    assetId: string,
    allowedParticipantIds: string[],
    isPublic: boolean,
  ): Promise<DataAccessPolicy> {
    const policy: DataAccessPolicy = { assetId, allowedParticipantIds, isPublic };
    await this.accessPolicyRepository.save(policy);
    return policy;
  }

  async checkAccess(assetId: string, participantId: string): Promise<boolean> {
    const policy = await this.accessPolicyRepository.getByAsset(assetId);
    if (!policy) return false;
    if (policy.isPublic) return true;
    return policy.allowedParticipantIds.includes(participantId);
  }
}
