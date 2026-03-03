import type {
  BlockchainGateway,
  PaymentReceipt,
  X402PaymentAdapter,
} from "../contracts";
import { PaymentSplitService } from "../../domain/payment-split";
import type { Task } from "../../domain/types";

export interface SettlementResult {
  blockchainTxId: string;
  receipts: PaymentReceipt[];
}

export class PactPay {
  private readonly splitter = new PaymentSplitService();

  constructor(
    private readonly blockchainGateway: BlockchainGateway,
    private readonly x402Adapter: X402PaymentAdapter,
    private readonly treasuryAccount = "treasury",
  ) {}

  async createEscrow(task: Task): Promise<void> {
    await this.blockchainGateway.createEscrow(task.id, task.issuerId, task.paymentCents);
  }

  async settle(task: Task): Promise<SettlementResult> {
    if (!task.assigneeId) {
      throw new Error(`Task ${task.id} has no assignee`);
    }

    const distribution = this.splitter.split(task.paymentCents, task.validatorIds);
    const payouts: Record<string, number> = {
      [task.assigneeId]: distribution.workerCents,
      [task.issuerId]: distribution.issuerCents,
      [this.treasuryAccount]: distribution.treasuryCents,
      ...distribution.validatorPayouts,
    };

    const blockchainTxId = await this.blockchainGateway.releaseEscrow(task.id, payouts);

    const receipts: PaymentReceipt[] = [];
    for (const [recipient, amountCents] of Object.entries(payouts)) {
      if (amountCents <= 0) {
        continue;
      }
      const receipt = await this.x402Adapter.transfer({
        from: `escrow:${task.id}`,
        to: recipient,
        amountCents,
        reference: task.id,
      });
      receipts.push(receipt);
    }

    return {
      blockchainTxId,
      receipts,
    };
  }

  async ledger(): Promise<PaymentReceipt[]> {
    return this.x402Adapter.ledger();
  }
}
