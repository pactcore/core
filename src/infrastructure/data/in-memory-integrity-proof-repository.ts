import type { IntegrityProofRepository } from "../../application/contracts";
import type { IntegrityProof } from "../../domain/types";

export class InMemoryIntegrityProofRepository implements IntegrityProofRepository {
  private readonly proofs = new Map<string, IntegrityProof>();

  async save(proof: IntegrityProof): Promise<void> {
    this.proofs.set(proof.assetId, proof);
  }

  async getByAsset(assetId: string): Promise<IntegrityProof | undefined> {
    return this.proofs.get(assetId);
  }
}
