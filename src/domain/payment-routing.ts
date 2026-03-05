export interface PaymentRoute {
  id: string;
  fromId: string;
  toId: string;
  amount: number;
  currency: string;
  reference: string;
  routeType: "direct" | "swap" | "aggregated" | "credit";
  status: "pending" | "completed" | "failed";
  createdAt: number;
}

export interface MicropaymentBatchEntry {
  payeeId: string;
  amountCents: number;
}

export interface MicropaymentBatch {
  id: string;
  payerId: string;
  entries: MicropaymentBatchEntry[];
  totalCents: number;
  batchedAt: number;
  settledAt?: number;
}

export interface CreditLine {
  id: string;
  issuerId: string;
  borrowerId: string;
  limitCents: number;
  usedCents: number;
  interestBps: number;
  createdAt: number;
  expiresAt?: number;
}

export interface GasSponsorshipGrant {
  id: string;
  sponsorId: string;
  beneficiaryId: string;
  maxGasCents: number;
  usedGasCents: number;
  createdAt: number;
}
