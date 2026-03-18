import type { IntegrityProofRepository } from "../../application/contracts";
import type { IntegrityProof } from "../../domain/types";

export class InMemoryIntegrityProofRepository implements IntegrityProofRepository {
  readonly durability = "memory" as const;

  private readonly proofs = new Map<string, IntegrityProof>();

  isDurable(): boolean {
    return false;
  }

  async save(proof: IntegrityProof): Promise<void> {
    this.proofs.set(proof.assetId, proof);
  }

  async getByAsset(assetId: string): Promise<IntegrityProof | undefined> {
    return this.proofs.get(assetId);
  }

  getHealth(): { name: string; state: string; checkedAt: number; durable: boolean; durability: string; features: Record<string, unknown> } {
    return {
      name: "integrity-proof-repository",
      state: "healthy",
      checkedAt: Date.now(),
      durable: false,
      durability: this.durability,
      features: {
        integrityVerification: true,
        proofs: this.proofs.size,
      },
    };
  }
}
