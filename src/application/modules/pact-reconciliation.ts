import type { SettlementRecord } from "../settlement-records";
import {
  type FailedSettlementExecution,
  PactEconomics,
  type ConnectorHealthReport,
} from "./pact-economics";

const DEFAULT_RECONCILIATION_LIMIT = 50;
const MAX_RECONCILIATION_LIMIT = 200;

export interface UnreconciledSettlementView {
  settlementId: string;
  pendingRecordCount: number;
  recordIds: string[];
  connectors: SettlementRecord["connector"][];
  oldestCreatedAt: number;
  records: SettlementRecord[];
}

export interface ReconciliationCycleResult {
  startedAt: number;
  completedAt: number;
  scannedRecordCount: number;
  reconciledRecordCount: number;
  pendingRecordCount: number;
  reconciledRecordIds: string[];
  connectorHealth: ConnectorHealthReport[];
}

export interface PactReconciliationOptions {
  pactEconomics: PactEconomics;
}

export type ReconciliationQueueState = "pending" | "failed" | "all";

export interface ReconciliationQueueRequest {
  state?: ReconciliationQueueState;
  connector?: SettlementRecord["connector"];
  settlementId?: string;
  idempotencyKey?: string;
  cursor?: string;
  limit?: number;
}

export interface ReconciliationQueueItem {
  settlementId: string;
  state: Exclude<ReconciliationQueueState, "all">;
  idempotencyKey?: string;
  pendingRecordCount: number;
  failedRecordCount: number;
  recordIds: string[];
  connectors: SettlementRecord["connector"][];
  oldestCreatedAt: number;
  updatedAt: number;
  lastError?: string;
  records: SettlementRecord[];
}

export interface ReconciliationQueuePage {
  items: ReconciliationQueueItem[];
  nextCursor?: string;
}

export interface ReconciliationSummary {
  pendingSettlementCount: number;
  pendingRecordCount: number;
  failedSettlementCount: number;
  failedRecordCount: number;
  connectorHealth: ConnectorHealthReport[];
}

export class PactReconciliation {
  private readonly pactEconomics: PactEconomics;

  constructor(options: PactReconciliationOptions) {
    this.pactEconomics = options.pactEconomics;
  }

  getConnectorHealth(): ConnectorHealthReport[] {
    return this.pactEconomics.getConnectorHealth();
  }

  async listUnreconciledSettlements(): Promise<UnreconciledSettlementView[]> {
    const records = await this.pactEconomics.listSettlementRecords({ status: "applied" });
    const grouped = new Map<string, UnreconciledSettlementView>();

    for (const record of records) {
      const existing = grouped.get(record.settlementId);
      if (existing) {
        existing.pendingRecordCount += 1;
        existing.recordIds.push(record.id);
        if (!existing.connectors.includes(record.connector)) {
          existing.connectors.push(record.connector);
        }
        existing.oldestCreatedAt = Math.min(existing.oldestCreatedAt, record.createdAt);
        existing.records.push(this.cloneRecord(record));
        continue;
      }

      grouped.set(record.settlementId, {
        settlementId: record.settlementId,
        pendingRecordCount: 1,
        recordIds: [record.id],
        connectors: [record.connector],
        oldestCreatedAt: record.createdAt,
        records: [this.cloneRecord(record)],
      });
    }

    return [...grouped.values()].sort((left, right) => {
      if (left.oldestCreatedAt === right.oldestCreatedAt) {
        return left.settlementId.localeCompare(right.settlementId);
      }
      return left.oldestCreatedAt - right.oldestCreatedAt;
    });
  }

  async listReconciliationQueue(
    input: ReconciliationQueueRequest = {},
  ): Promise<ReconciliationQueuePage> {
    const cursor = this.parseCursor(input.cursor);
    const limit = this.normalizeLimit(input.limit);
    const state = input.state ?? "pending";

    const allItems = (await this.buildAllQueueItems())
      .filter((item) => state === "all" || item.state === state)
      .filter((item) => !input.connector || item.connectors.includes(input.connector))
      .filter((item) => !input.settlementId || item.settlementId === input.settlementId)
      .filter((item) => !input.idempotencyKey || item.idempotencyKey === input.idempotencyKey)
      .sort((left, right) => {
        if (left.updatedAt === right.updatedAt) {
          if (left.settlementId === right.settlementId) {
            if ((left.idempotencyKey ?? "") === (right.idempotencyKey ?? "")) {
              return left.state.localeCompare(right.state);
            }
            return (left.idempotencyKey ?? "").localeCompare(right.idempotencyKey ?? "");
          }
          return left.settlementId.localeCompare(right.settlementId);
        }
        return left.updatedAt - right.updatedAt;
      });

    const items = allItems.slice(cursor, cursor + limit).map((item) => this.cloneQueueItem(item));
    const nextCursor = cursor + limit < allItems.length ? String(cursor + limit) : undefined;

    return {
      items,
      nextCursor,
    };
  }

  async getReconciliationSummary(): Promise<ReconciliationSummary> {
    const pendingItems = (await this.listUnreconciledSettlements()).map((settlement) =>
      this.buildPendingQueueItem(settlement),
    );
    const failedItems = this.pactEconomics
      .listFailedSettlementExecutions()
      .map((failure) => this.buildFailedQueueItem(failure));

    return {
      pendingSettlementCount: pendingItems.length,
      pendingRecordCount: pendingItems.reduce((sum, item) => sum + item.pendingRecordCount, 0),
      failedSettlementCount: failedItems.length,
      failedRecordCount: failedItems.reduce((sum, item) => sum + item.failedRecordCount, 0),
      connectorHealth: this.getConnectorHealth(),
    };
  }

  async runReconciliationCycle(): Promise<ReconciliationCycleResult> {
    const startedAt = Date.now();
    const unreconciledRecords = await this.pactEconomics.listSettlementRecords({ status: "applied" });
    const reconciledRecordIds: string[] = [];

    for (const record of unreconciledRecords) {
      const matched = await this.pactEconomics.canReconcileSettlementRecord(record);
      if (!matched) {
        continue;
      }

      const reconciled = await this.pactEconomics.reconcileSettlementRecord({
        recordId: record.id,
        reconciledBy: "pact-reconciliation",
        note: "connector ledger matched during reconciliation cycle",
      });
      reconciledRecordIds.push(reconciled.id);
    }

    const pending = await this.listUnreconciledSettlements();
    return {
      startedAt,
      completedAt: Date.now(),
      scannedRecordCount: unreconciledRecords.length,
      reconciledRecordCount: reconciledRecordIds.length,
      pendingRecordCount: pending.reduce((sum, settlement) => sum + settlement.pendingRecordCount, 0),
      reconciledRecordIds,
      connectorHealth: this.getConnectorHealth(),
    };
  }

  private cloneRecord(record: SettlementRecord): SettlementRecord {
    return {
      ...record,
      connectorMetadata: record.connectorMetadata ? { ...record.connectorMetadata } : undefined,
    };
  }

  private async buildAllQueueItems(): Promise<ReconciliationQueueItem[]> {
    const pendingItems = (await this.listUnreconciledSettlements()).map((settlement) =>
      this.buildPendingQueueItem(settlement),
    );
    const failedItems = this.pactEconomics
      .listFailedSettlementExecutions()
      .map((failure) => this.buildFailedQueueItem(failure));

    return [...pendingItems, ...failedItems];
  }

  private buildPendingQueueItem(settlement: UnreconciledSettlementView): ReconciliationQueueItem {
    return {
      settlementId: settlement.settlementId,
      state: "pending",
      pendingRecordCount: settlement.pendingRecordCount,
      failedRecordCount: 0,
      recordIds: [...settlement.recordIds],
      connectors: [...settlement.connectors],
      oldestCreatedAt: settlement.oldestCreatedAt,
      updatedAt: settlement.oldestCreatedAt,
      records: settlement.records.map((record) => this.cloneRecord(record)),
    };
  }

  private buildFailedQueueItem(failure: FailedSettlementExecution): ReconciliationQueueItem {
    return {
      settlementId: failure.settlementId,
      state: "failed",
      idempotencyKey: failure.idempotencyKey,
      pendingRecordCount: 0,
      failedRecordCount: 1,
      recordIds: [],
      connectors: [],
      oldestCreatedAt: failure.failedAt,
      updatedAt: failure.failedAt,
      lastError: failure.error,
      records: [],
    };
  }

  private cloneQueueItem(item: ReconciliationQueueItem): ReconciliationQueueItem {
    return {
      ...item,
      recordIds: [...item.recordIds],
      connectors: [...item.connectors],
      records: item.records.map((record) => this.cloneRecord(record)),
    };
  }

  private parseCursor(cursor?: string): number {
    if (!cursor) {
      return 0;
    }

    const parsed = Number(cursor);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`invalid cursor: ${cursor}`);
    }

    return parsed;
  }

  private normalizeLimit(limit?: number): number {
    if (limit === undefined) {
      return DEFAULT_RECONCILIATION_LIMIT;
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECONCILIATION_LIMIT) {
      throw new Error(`invalid limit: ${limit}`);
    }

    return limit;
  }
}
