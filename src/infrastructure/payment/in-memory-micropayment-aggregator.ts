import type { MicropaymentAggregator } from "../../application/contracts";
import { generateId } from "../../application/utils";
import type { MicropaymentBatch, MicropaymentBatchEntry } from "../../domain/payment-routing";

export class InMemoryMicropaymentAggregator implements MicropaymentAggregator {
  private readonly pendingByPayer = new Map<string, MicropaymentBatchEntry[]>();

  async addEntry(payerId: string, payeeId: string, amountCents: number): Promise<void> {
    if (!payerId.trim()) {
      throw new Error("payerId is required");
    }
    if (!payeeId.trim()) {
      throw new Error("payeeId is required");
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new Error("micropayment amount must be a positive integer number of cents");
    }

    const entries = this.pendingByPayer.get(payerId) ?? [];
    entries.push({ payeeId, amountCents });
    this.pendingByPayer.set(payerId, entries);
  }

  async flush(payerId: string): Promise<MicropaymentBatch> {
    const entries = this.pendingByPayer.get(payerId) ?? [];
    const copiedEntries = entries.map((entry) => ({ ...entry }));
    const now = Date.now();
    const batch: MicropaymentBatch = {
      id: generateId("mp_batch"),
      payerId,
      entries: copiedEntries,
      totalCents: copiedEntries.reduce((sum, entry) => sum + entry.amountCents, 0),
      batchedAt: now,
      settledAt: now,
    };

    this.pendingByPayer.set(payerId, []);
    return batch;
  }
}
