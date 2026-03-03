import type { BlockchainGateway } from "../../application/contracts";
import type { EscrowAccount } from "../../blockchain/abstraction";

export class InMemoryBaseChainGateway implements BlockchainGateway {
  private readonly escrows = new Map<string, EscrowAccount>();

  async createEscrow(taskId: string, payerId: string, amountCents: number): Promise<EscrowAccount> {
    const escrow: EscrowAccount = {
      taskId,
      payerId,
      amountCents,
      released: false,
    };
    this.escrows.set(taskId, escrow);
    return escrow;
  }

  async releaseEscrow(taskId: string): Promise<string> {
    const escrow = this.escrows.get(taskId);
    if (!escrow) {
      throw new Error(`Escrow not found for task ${taskId}`);
    }
    if (escrow.released) {
      throw new Error(`Escrow for task ${taskId} already released`);
    }

    const txId = `base_${crypto.randomUUID()}`;
    this.escrows.set(taskId, {
      ...escrow,
      released: true,
      releaseTxId: txId,
    });
    return txId;
  }

  async getEscrow(taskId: string): Promise<EscrowAccount | undefined> {
    return this.escrows.get(taskId);
  }
}
