import type { ZKProofRepository } from "../../application/contracts";
import type { ZKProof, ZKProofType } from "../../domain/zk-proofs";

export class InMemoryZKProofRepository implements ZKProofRepository {
  private readonly proofs = new Map<string, ZKProof>();

  async save(proof: ZKProof): Promise<void> {
    this.proofs.set(proof.id, proof);
  }

  async getById(id: string): Promise<ZKProof | undefined> {
    return this.proofs.get(id);
  }

  async getByProver(proverId: string): Promise<ZKProof[]> {
    return [...this.proofs.values()].filter((proof) => proof.proverId === proverId);
  }

  async getByType(type: ZKProofType): Promise<ZKProof[]> {
    return [...this.proofs.values()].filter((proof) => proof.type === type);
  }
}
