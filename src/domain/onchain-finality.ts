const DEFAULT_QUERY_LIMIT = 50;
const MAX_QUERY_LIMIT = 200;

export type OnchainTransactionStatus = "submitted" | "confirmed" | "finalized" | "reorged";

export type OnchainTransactionOperation =
  | "governance_proposal_create"
  | "governance_proposal_vote"
  | "governance_proposal_execute"
  | "rewards_epoch_sync"
  | "rewards_claim_sync";

export interface TrackOnchainTransactionInput {
  txId: string;
  operation: OnchainTransactionOperation;
  submittedAt?: number;
  participantId?: string;
  proposalId?: string;
  epoch?: number;
  referenceId?: string;
}

export interface RecordOnchainTransactionInclusionInput {
  txId: string;
  blockNumber: number;
  blockHash: string;
  includedAt?: number;
}

export interface RecordCanonicalBlockInput {
  blockNumber: number;
  blockHash: string;
}

export interface OnchainTransactionRecord {
  txId: string;
  operation: OnchainTransactionOperation;
  status: OnchainTransactionStatus;
  submittedAt: number;
  includedAt?: number;
  finalizedAt?: number;
  reorgedAt?: number;
  lastUpdatedAt: number;
  participantId?: string;
  proposalId?: string;
  epoch?: number;
  referenceId?: string;
  blockNumber?: number;
  blockHash?: string;
  confirmations: number;
  confirmationDepth: number;
  finalityDepth: number;
}

export interface OnchainTransactionQuery {
  status?: OnchainTransactionStatus | "all";
  operation?: OnchainTransactionOperation;
  participantId?: string;
  proposalId?: string;
  epoch?: number;
  referenceId?: string;
  cursor?: string;
  limit?: number;
}

export interface OnchainTransactionPage {
  items: OnchainTransactionRecord[];
  nextCursor?: string;
}

export interface OnchainFinalitySummary {
  trackedTransactionCount: number;
  submittedCount: number;
  confirmedCount: number;
  finalizedCount: number;
  reorgedCount: number;
  headBlockNumber?: number;
  confirmationDepth: number;
  finalityDepth: number;
}

export interface OnchainIndexerHookEvent {
  kind: "tracked" | "included" | "status_changed" | "reorged" | "finalized";
  transaction: OnchainTransactionRecord;
  previousTransaction?: OnchainTransactionRecord;
  summary: OnchainFinalitySummary;
}

export type OnchainIndexerHook = (event: OnchainIndexerHookEvent) => void | Promise<void>;

export interface OnchainFinalityProvider {
  trackTransaction(input: TrackOnchainTransactionInput): OnchainTransactionRecord;
  recordTransactionInclusion(input: RecordOnchainTransactionInclusionInput): OnchainTransactionRecord;
  recordCanonicalBlock(input: RecordCanonicalBlockInput): void;
  advanceHead(blockNumber: number, blockHash?: string): OnchainFinalitySummary;
  getTransaction(txId: string): OnchainTransactionRecord | undefined;
  listTransactions(query?: OnchainTransactionQuery): OnchainTransactionPage;
  getSummary(): OnchainFinalitySummary;
}

export interface OnchainFinalityRuntimeConfig {
  confirmationDepth?: number;
  finalityDepth?: number;
  now?: () => number;
  hooks?: OnchainIndexerHook[];
}

export class OnchainFinalityRuntime {
  private readonly confirmationDepth: number;
  private readonly finalityDepth: number;
  private readonly now: () => number;
  private readonly hooks: OnchainIndexerHook[];
  private readonly transactions = new Map<string, OnchainTransactionRecord>();
  private readonly canonicalBlockHashes = new Map<number, string>();
  private headBlockNumber?: number;

  constructor(config: OnchainFinalityRuntimeConfig = {}) {
    this.confirmationDepth = normalizePositiveInteger(config.confirmationDepth ?? 2, "confirmationDepth");
    this.finalityDepth = normalizePositiveInteger(config.finalityDepth ?? 6, "finalityDepth");
    this.now = config.now ?? (() => Date.now());
    this.hooks = [...(config.hooks ?? [])];

    if (this.finalityDepth < this.confirmationDepth) {
      throw new Error("finalityDepth must be greater than or equal to confirmationDepth");
    }
  }

  trackTransaction(input: TrackOnchainTransactionInput): OnchainTransactionRecord {
    const txId = assertNonEmptyString(input.txId, "txId");
    const existing = this.transactions.get(txId);
    const timestamp = input.submittedAt ?? existing?.submittedAt ?? this.now();
    const next: OnchainTransactionRecord = {
      txId,
      operation: input.operation,
      status: existing?.status ?? "submitted",
      submittedAt: timestamp,
      includedAt: existing?.includedAt,
      finalizedAt: existing?.finalizedAt,
      reorgedAt: existing?.reorgedAt,
      lastUpdatedAt: this.now(),
      participantId: input.participantId ?? existing?.participantId,
      proposalId: input.proposalId ?? existing?.proposalId,
      epoch: input.epoch ?? existing?.epoch,
      referenceId: input.referenceId ?? existing?.referenceId,
      blockNumber: existing?.blockNumber,
      blockHash: existing?.blockHash,
      confirmations: existing?.confirmations ?? 0,
      confirmationDepth: this.confirmationDepth,
      finalityDepth: this.finalityDepth,
    };

    return this.cloneTransaction(this.storeTransaction(txId, next, "tracked"));
  }

  recordTransactionInclusion(
    input: RecordOnchainTransactionInclusionInput,
  ): OnchainTransactionRecord {
    const existing = this.getRequiredTransaction(input.txId);
    const blockNumber = normalizeNonNegativeInteger(input.blockNumber, "blockNumber");
    const blockHash = assertNonEmptyString(input.blockHash, "blockHash");
    const includedAt = input.includedAt ?? this.now();

    const next: OnchainTransactionRecord = {
      ...existing,
      status: "submitted",
      includedAt,
      finalizedAt: undefined,
      reorgedAt: undefined,
      lastUpdatedAt: this.now(),
      blockNumber,
      blockHash,
      confirmations: 0,
    };
    this.canonicalBlockHashes.set(blockNumber, blockHash);
    return this.cloneTransaction(this.storeTransaction(existing.txId, next, "included"));
  }

  recordCanonicalBlock(input: RecordCanonicalBlockInput): void {
    const blockNumber = normalizeNonNegativeInteger(input.blockNumber, "blockNumber");
    const blockHash = assertNonEmptyString(input.blockHash, "blockHash");
    this.canonicalBlockHashes.set(blockNumber, blockHash);
    this.recalculateStates();
  }

  advanceHead(blockNumber: number, blockHash?: string): OnchainFinalitySummary {
    const normalizedBlockNumber = normalizeNonNegativeInteger(blockNumber, "blockNumber");
    this.headBlockNumber = normalizedBlockNumber;
    if (blockHash) {
      this.recordCanonicalBlock({ blockNumber: normalizedBlockNumber, blockHash });
    } else {
      this.recalculateStates();
    }
    return this.getSummary();
  }

  getTransaction(txId: string): OnchainTransactionRecord | undefined {
    const transaction = this.transactions.get(txId);
    return transaction ? this.cloneTransaction(transaction) : undefined;
  }

  listTransactions(query: OnchainTransactionQuery = {}): OnchainTransactionPage {
    const cursor = parseCursor(query.cursor);
    const limit = normalizeLimit(query.limit);
    const status = query.status ?? "all";

    const matching = [...this.transactions.values()]
      .filter((transaction) => status === "all" || transaction.status === status)
      .filter((transaction) => !query.operation || transaction.operation === query.operation)
      .filter((transaction) => !query.participantId || transaction.participantId === query.participantId)
      .filter((transaction) => !query.proposalId || transaction.proposalId === query.proposalId)
      .filter((transaction) => query.epoch === undefined || transaction.epoch === query.epoch)
      .filter((transaction) => !query.referenceId || transaction.referenceId === query.referenceId)
      .sort((left, right) => {
        if (left.submittedAt === right.submittedAt) {
          return left.txId.localeCompare(right.txId);
        }
        return left.submittedAt - right.submittedAt;
      });

    const items = matching.slice(cursor, cursor + limit).map((transaction) => this.cloneTransaction(transaction));
    const nextCursor = cursor + limit < matching.length ? String(cursor + limit) : undefined;

    return {
      items,
      nextCursor,
    };
  }

  getSummary(): OnchainFinalitySummary {
    let submittedCount = 0;
    let confirmedCount = 0;
    let finalizedCount = 0;
    let reorgedCount = 0;

    for (const transaction of this.transactions.values()) {
      switch (transaction.status) {
        case "submitted":
          submittedCount += 1;
          break;
        case "confirmed":
          confirmedCount += 1;
          break;
        case "finalized":
          finalizedCount += 1;
          break;
        case "reorged":
          reorgedCount += 1;
          break;
      }
    }

    return {
      trackedTransactionCount: this.transactions.size,
      submittedCount,
      confirmedCount,
      finalizedCount,
      reorgedCount,
      headBlockNumber: this.headBlockNumber,
      confirmationDepth: this.confirmationDepth,
      finalityDepth: this.finalityDepth,
    };
  }

  private getRequiredTransaction(txId: string): OnchainTransactionRecord {
    const transaction = this.transactions.get(txId);
    if (!transaction) {
      throw new Error(`onchain transaction not found: ${txId}`);
    }
    return this.cloneTransaction(transaction);
  }

  private recalculateStates(): void {
    for (const [txId, transaction] of this.transactions.entries()) {
      const resolved = this.resolveTransactionState(transaction);
      this.transactions.set(txId, resolved);
      this.emitTransitionEvents(transaction, resolved);
    }
  }

  private storeTransaction(
    txId: string,
    transaction: OnchainTransactionRecord,
    eventKind: Extract<OnchainIndexerHookEvent["kind"], "tracked" | "included">,
  ): OnchainTransactionRecord {
    const previousTransaction = this.transactions.get(txId);
    const resolved = this.resolveTransactionState(transaction);
    this.transactions.set(txId, resolved);
    this.emitHook(eventKind, resolved, previousTransaction);
    this.emitTransitionEvents(previousTransaction, resolved);
    return resolved;
  }

  private emitTransitionEvents(
    previousTransaction: OnchainTransactionRecord | undefined,
    nextTransaction: OnchainTransactionRecord,
  ): void {
    if (!previousTransaction || this.transactionsEqual(previousTransaction, nextTransaction)) {
      return;
    }

    if (previousTransaction.status !== nextTransaction.status) {
      this.emitHook("status_changed", nextTransaction, previousTransaction);
    }
    if (previousTransaction.status !== "reorged" && nextTransaction.status === "reorged") {
      this.emitHook("reorged", nextTransaction, previousTransaction);
    }
    if (previousTransaction.status !== "finalized" && nextTransaction.status === "finalized") {
      this.emitHook("finalized", nextTransaction, previousTransaction);
    }
  }

  private emitHook(
    kind: OnchainIndexerHookEvent["kind"],
    transaction: OnchainTransactionRecord,
    previousTransaction?: OnchainTransactionRecord,
  ): void {
    if (this.hooks.length === 0) {
      return;
    }

    const event: OnchainIndexerHookEvent = {
      kind,
      transaction: this.cloneTransaction(transaction),
      previousTransaction: previousTransaction ? this.cloneTransaction(previousTransaction) : undefined,
      summary: this.getSummary(),
    };

    for (const hook of this.hooks) {
      void hook(event);
    }
  }

  private transactionsEqual(left: OnchainTransactionRecord, right: OnchainTransactionRecord): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private resolveTransactionState(transaction: OnchainTransactionRecord): OnchainTransactionRecord {
    if (transaction.blockNumber === undefined || transaction.blockHash === undefined) {
      return {
        ...transaction,
        status: transaction.status === "reorged" ? "reorged" : "submitted",
        confirmations: 0,
        finalizedAt: undefined,
      };
    }

    const canonicalHash = this.canonicalBlockHashes.get(transaction.blockNumber);
    if (canonicalHash && canonicalHash !== transaction.blockHash) {
      return {
        ...transaction,
        status: "reorged",
        confirmations: 0,
        finalizedAt: undefined,
        reorgedAt: transaction.reorgedAt ?? this.now(),
        lastUpdatedAt: this.now(),
      };
    }

    const confirmations = this.headBlockNumber === undefined || this.headBlockNumber < transaction.blockNumber
      ? 0
      : this.headBlockNumber - transaction.blockNumber + 1;

    if (confirmations >= this.finalityDepth) {
      return {
        ...transaction,
        status: "finalized",
        confirmations,
        finalizedAt: transaction.finalizedAt ?? this.now(),
        reorgedAt: undefined,
        lastUpdatedAt: this.now(),
      };
    }

    if (confirmations >= this.confirmationDepth) {
      return {
        ...transaction,
        status: "confirmed",
        confirmations,
        finalizedAt: undefined,
        reorgedAt: undefined,
        lastUpdatedAt: this.now(),
      };
    }

    return {
      ...transaction,
      status: "submitted",
      confirmations,
      finalizedAt: undefined,
      reorgedAt: undefined,
      lastUpdatedAt: this.now(),
    };
  }

  private cloneTransaction(transaction: OnchainTransactionRecord): OnchainTransactionRecord {
    return {
      ...transaction,
    };
  }
}

function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value.trim();
}

function normalizePositiveInteger(value: unknown, fieldName: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return Number(value);
}

function normalizeNonNegativeInteger(value: unknown, fieldName: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return Number(value);
}

function parseCursor(cursor?: string): number {
  if (!cursor) {
    return 0;
  }

  const parsed = Number(cursor);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`invalid cursor: ${cursor}`);
  }
  return parsed;
}

function normalizeLimit(limit?: number): number {
  if (limit === undefined) {
    return DEFAULT_QUERY_LIMIT;
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_QUERY_LIMIT) {
    throw new Error(`invalid limit: ${limit}`);
  }

  return limit;
}
