import type { ZKVerificationReceiptRepository } from "../../application/contracts";
import type { ZKVerificationReceipt } from "../../domain/zk-bridge";

export class InMemoryZKVerificationReceiptRepository implements ZKVerificationReceiptRepository {
  private readonly receipts = new Map<string, ZKVerificationReceipt[]>();

  async save(receipt: ZKVerificationReceipt): Promise<void> {
    const existing = this.receipts.get(receipt.proofId) ?? [];
    existing.push(structuredClone(receipt));
    this.receipts.set(receipt.proofId, existing);
  }

  async listByProofId(proofId: string): Promise<ZKVerificationReceipt[]> {
    return (this.receipts.get(proofId) ?? []).map((receipt) => structuredClone(receipt));
  }
}
