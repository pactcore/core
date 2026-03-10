import type {
  OnchainFinalityProvider,
  OnchainFinalitySummary,
  OnchainTransactionQuery,
  OnchainTransactionRecord,
} from "../domain/onchain-finality";
import { RuntimeOnchainFinalityProvider, type OnchainRpcProvider } from "./providers";

const PAGE_LIMIT = 200;

export interface OnchainBlockHeader {
  blockNumber: number;
  blockHash: string;
  parentHash?: string;
}

export interface OnchainTransactionReceipt {
  txId: string;
  blockNumber: number;
  blockHash: string;
}

export interface OnchainIndexerDataSource {
  getHeadBlock(): Promise<OnchainBlockHeader | undefined>;
  getCanonicalBlock(blockNumber: number): Promise<OnchainBlockHeader | undefined>;
  getTransactionReceipt(txId: string): Promise<OnchainTransactionReceipt | undefined>;
}

export interface OnchainIndexerSyncEvent {
  kind: "head_synced" | "transaction_missing" | "transaction_synced";
  txId?: string;
  head?: OnchainBlockHeader;
  transaction?: OnchainTransactionRecord;
}

export type OnchainIndexerSyncHook = (event: OnchainIndexerSyncEvent) => void | Promise<void>;

export interface LiveOnchainIndexerOptions {
  dataSource: OnchainIndexerDataSource;
  finalityProvider?: OnchainFinalityProvider;
  hooks?: OnchainIndexerSyncHook[];
}

export class LiveOnchainIndexer {
  private readonly dataSource: OnchainIndexerDataSource;
  private readonly finalityProvider: OnchainFinalityProvider;
  private readonly hooks: OnchainIndexerSyncHook[];

  constructor(options: LiveOnchainIndexerOptions) {
    this.dataSource = options.dataSource;
    this.finalityProvider = options.finalityProvider ?? new RuntimeOnchainFinalityProvider();
    this.hooks = [...(options.hooks ?? [])];
  }

  async syncHead(): Promise<OnchainFinalitySummary> {
    const head = await this.dataSource.getHeadBlock();
    if (!head) {
      return this.finalityProvider.getSummary();
    }

    this.finalityProvider.recordCanonicalBlock({
      blockNumber: head.blockNumber,
      blockHash: head.blockHash,
    });
    const summary = this.finalityProvider.advanceHead(head.blockNumber, head.blockHash);
    await this.emit({ kind: "head_synced", head });
    return summary;
  }

  async syncTransaction(txId: string): Promise<OnchainTransactionRecord | undefined> {
    const receipt = await this.dataSource.getTransactionReceipt(txId);
    if (!receipt) {
      const transaction = this.finalityProvider.getTransaction(txId);
      await this.emit({ kind: "transaction_missing", txId, transaction });
      return transaction;
    }

    this.finalityProvider.recordTransactionInclusion({
      txId,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
    });

    const canonicalBlock = await this.dataSource.getCanonicalBlock(receipt.blockNumber);
    if (canonicalBlock) {
      this.finalityProvider.recordCanonicalBlock({
        blockNumber: canonicalBlock.blockNumber,
        blockHash: canonicalBlock.blockHash,
      });
    }

    await this.syncHead();
    const transaction = this.finalityProvider.getTransaction(txId);
    await this.emit({ kind: "transaction_synced", txId, transaction });
    return transaction;
  }

  async syncTrackedTransactions(query: OnchainTransactionQuery = {}): Promise<OnchainTransactionRecord[]> {
    const tracked = this.listTrackedTransactions(query);
    const synced: OnchainTransactionRecord[] = [];

    await this.syncHead();
    for (const transaction of tracked) {
      const resolved = await this.syncTransaction(transaction.txId);
      if (resolved) {
        synced.push(resolved);
      }
    }

    return synced;
  }

  getFinalityProvider(): OnchainFinalityProvider {
    return this.finalityProvider;
  }

  private listTrackedTransactions(query: OnchainTransactionQuery): OnchainTransactionRecord[] {
    const items: OnchainTransactionRecord[] = [];
    let cursor = query.cursor;

    while (true) {
      const page = this.finalityProvider.listTransactions({
        ...query,
        status: query.status ?? "all",
        cursor,
        limit: PAGE_LIMIT,
      });
      items.push(...page.items);
      if (!page.nextCursor) {
        return items;
      }
      cursor = page.nextCursor;
    }
  }

  private async emit(event: OnchainIndexerSyncEvent): Promise<void> {
    for (const hook of this.hooks) {
      await hook({
        ...event,
        head: event.head ? { ...event.head } : undefined,
        transaction: event.transaction ? { ...event.transaction } : undefined,
      });
    }
  }
}

export class RpcOnchainIndexerDataSource implements OnchainIndexerDataSource {
  constructor(private readonly rpcProvider: OnchainRpcProvider) {}

  async getHeadBlock(): Promise<OnchainBlockHeader | undefined> {
    const block = await this.rpcProvider.request("eth_getBlockByNumber", ["latest", false]);
    return parseBlockHeader(block);
  }

  async getCanonicalBlock(blockNumber: number): Promise<OnchainBlockHeader | undefined> {
    const block = await this.rpcProvider.request("eth_getBlockByNumber", [toRpcQuantity(blockNumber), false]);
    return parseBlockHeader(block);
  }

  async getTransactionReceipt(txId: string): Promise<OnchainTransactionReceipt | undefined> {
    const receipt = await this.rpcProvider.request("eth_getTransactionReceipt", [txId]);
    if (receipt === null || receipt === undefined) {
      return undefined;
    }

    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
      throw new Error("eth_getTransactionReceipt returned an invalid receipt payload");
    }

    const parsed = receipt as Record<string, unknown>;
    return {
      txId: normalizeHexString(parsed.transactionHash, "transactionHash"),
      blockNumber: parseRpcQuantity(parsed.blockNumber, "blockNumber"),
      blockHash: normalizeHexString(parsed.blockHash, "blockHash"),
    };
  }
}

function parseBlockHeader(value: unknown): OnchainBlockHeader | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("RPC block payload must be an object");
  }

  const block = value as Record<string, unknown>;
  return {
    blockNumber: parseRpcQuantity(block.number, "number"),
    blockHash: normalizeHexString(block.hash, "hash"),
    parentHash: block.parentHash ? normalizeHexString(block.parentHash, "parentHash") : undefined,
  };
}

function parseRpcQuantity(value: unknown, label: string): number {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error(`${label} must be a hex quantity`);
  }

  return Number.parseInt(value.slice(2), 16);
}

function normalizeHexString(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error(`${label} must be a hex string`);
  }

  return value.toLowerCase();
}

function toRpcQuantity(value: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`blockNumber must be a non-negative integer. Received: ${value}`);
  }

  return `0x${value.toString(16)}`;
}
