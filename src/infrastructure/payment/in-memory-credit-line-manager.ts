import type { CreditLineManager } from "../../application/contracts";
import { generateId } from "../../application/utils";
import type { CreditLine } from "../../domain/payment-routing";

export class InMemoryCreditLineManager implements CreditLineManager {
  private readonly lines = new Map<string, CreditLine>();

  async open(
    issuerId: string,
    borrowerId: string,
    limitCents: number,
    interestBps: number,
    expiresAt?: number,
  ): Promise<CreditLine> {
    if (!issuerId.trim()) {
      throw new Error("issuerId is required");
    }
    if (!borrowerId.trim()) {
      throw new Error("borrowerId is required");
    }
    if (!Number.isInteger(limitCents) || limitCents <= 0) {
      throw new Error("credit line limit must be a positive integer number of cents");
    }
    if (!Number.isInteger(interestBps) || interestBps < 0) {
      throw new Error("interestBps must be a non-negative integer");
    }

    const line: CreditLine = {
      id: generateId("credit_line"),
      issuerId,
      borrowerId,
      limitCents,
      usedCents: 0,
      interestBps,
      createdAt: Date.now(),
      expiresAt,
    };

    this.lines.set(line.id, line);
    return { ...line };
  }

  async use(lineId: string, amountCents: number): Promise<CreditLine> {
    const line = this.getLineOrThrow(lineId);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new Error("credit usage amount must be a positive integer number of cents");
    }
    if (line.expiresAt && Date.now() > line.expiresAt) {
      throw new Error(`Credit line ${lineId} is expired`);
    }

    const nextUsed = line.usedCents + amountCents;
    if (nextUsed > line.limitCents) {
      throw new Error(`Credit line ${lineId} limit exceeded`);
    }

    const updated: CreditLine = {
      ...line,
      usedCents: nextUsed,
    };
    this.lines.set(lineId, updated);
    return { ...updated };
  }

  async repay(lineId: string, amountCents: number): Promise<CreditLine> {
    const line = this.getLineOrThrow(lineId);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new Error("repayment amount must be a positive integer number of cents");
    }

    const updated: CreditLine = {
      ...line,
      usedCents: Math.max(0, line.usedCents - amountCents),
    };
    this.lines.set(lineId, updated);
    return { ...updated };
  }

  async getLine(lineId: string): Promise<CreditLine | undefined> {
    const line = this.lines.get(lineId);
    if (!line) {
      return undefined;
    }
    return { ...line };
  }

  async listByBorrower(borrowerId: string): Promise<CreditLine[]> {
    return [...this.lines.values()]
      .filter((line) => line.borrowerId === borrowerId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((line) => ({ ...line }));
  }

  private getLineOrThrow(lineId: string): CreditLine {
    const line = this.lines.get(lineId);
    if (!line) {
      throw new Error(`Credit line ${lineId} not found`);
    }
    return line;
  }
}
