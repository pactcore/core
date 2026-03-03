import type {
  PaymentReceipt,
  PaymentTransfer,
  X402PaymentAdapter,
} from "../../application/contracts";

export class InMemoryX402PaymentAdapter implements X402PaymentAdapter {
  private readonly receipts: PaymentReceipt[] = [];

  async transfer(transfer: PaymentTransfer): Promise<PaymentReceipt> {
    const receipt: PaymentReceipt = {
      ...transfer,
      txId: `x402_${crypto.randomUUID()}`,
      executedAt: Date.now(),
    };
    this.receipts.push(receipt);
    return receipt;
  }

  async ledger(): Promise<PaymentReceipt[]> {
    return [...this.receipts];
  }
}
