import type {
  ReconcileSettlementRecordInput,
  SettlementRecord,
  SettlementRecordLifecycleEntry,
  SettlementRecordPage,
  SettlementRecordPageRequest,
  SettlementRecordQueryFilter,
  SettlementRecordReplayPage,
  SettlementRecordReplayRequest,
  SettlementRecordRepository,
} from "../../application/settlement-records";

const DEFAULT_QUERY_LIMIT = 50;
const MAX_QUERY_LIMIT = 200;
const DEFAULT_REPLAY_LIMIT = 100;
const MAX_REPLAY_LIMIT = 500;

export class InMemoryDurableSettlementRecordRepository implements SettlementRecordRepository {
  private readonly records = new Map<string, SettlementRecord>();
  private readonly lifecycle = new Array<SettlementRecordLifecycleEntry>();

  async append(record: SettlementRecord): Promise<void> {
    if (this.records.has(record.id)) {
      throw new Error(`settlement record already exists: ${record.id}`);
    }

    const snapshot = this.cloneRecord(record);
    this.records.set(snapshot.id, snapshot);
    this.appendLifecycle("created", snapshot, snapshot.createdAt);
  }

  async getById(recordId: string): Promise<SettlementRecord | undefined> {
    const record = this.records.get(recordId);
    return record ? this.cloneRecord(record) : undefined;
  }

  async query(
    filter?: SettlementRecordQueryFilter,
    page?: SettlementRecordPageRequest,
  ): Promise<SettlementRecordPage> {
    const cursor = this.parseCursor(page?.cursor);
    const limit = this.normalizeLimit(page?.limit, DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);

    const matching = [...this.records.values()]
      .filter((record) => this.matchesFilter(record, filter))
      .sort((a, b) => {
        if (a.createdAt === b.createdAt) {
          return a.id.localeCompare(b.id);
        }
        return a.createdAt - b.createdAt;
      });

    if (cursor >= matching.length) {
      return { items: [] };
    }

    const pageItems = matching.slice(cursor, cursor + limit).map((record) => this.cloneRecord(record));
    const nextCursor = cursor + limit < matching.length ? String(cursor + limit) : undefined;

    return {
      items: pageItems,
      nextCursor,
    };
  }

  async reconcile(
    recordId: string,
    input: ReconcileSettlementRecordInput = {},
  ): Promise<SettlementRecord> {
    const current = this.records.get(recordId);
    if (!current) {
      throw new Error(`settlement record not found: ${recordId}`);
    }

    if (current.status === "reconciled") {
      return this.cloneRecord(current);
    }

    const reconciledAt = input.reconciledAt ?? Date.now();
    const next: SettlementRecord = {
      ...current,
      status: "reconciled",
      reconciledAt,
      reconciledBy: input.reconciledBy,
      reconciliationNote: input.note,
    };

    this.records.set(recordId, this.cloneRecord(next));
    this.appendLifecycle("reconciled", next, reconciledAt);
    return this.cloneRecord(next);
  }

  async replay(request: SettlementRecordReplayRequest = {}): Promise<SettlementRecordReplayPage> {
    const fromOffset = this.normalizeOffset(request.fromOffset, "fromOffset");
    const limit = this.normalizeLimit(request.limit, DEFAULT_REPLAY_LIMIT, MAX_REPLAY_LIMIT);
    const entries = this.lifecycle
      .slice(fromOffset, fromOffset + limit)
      .map((entry) => this.cloneLifecycleEntry(entry));

    const nextOffset = fromOffset + limit < this.lifecycle.length ? fromOffset + limit : undefined;

    return {
      entries,
      nextOffset,
    };
  }

  private matchesFilter(record: SettlementRecord, filter?: SettlementRecordQueryFilter): boolean {
    if (!filter) {
      return true;
    }
    if (filter.settlementId && record.settlementId !== filter.settlementId) {
      return false;
    }
    if (filter.assetId && record.assetId !== filter.assetId) {
      return false;
    }
    if (filter.rail && record.rail !== filter.rail) {
      return false;
    }
    if (filter.payerId && record.payerId !== filter.payerId) {
      return false;
    }
    if (filter.payeeId && record.payeeId !== filter.payeeId) {
      return false;
    }
    if (filter.status && record.status !== filter.status) {
      return false;
    }
    if (filter.reconciledBy && record.reconciledBy !== filter.reconciledBy) {
      return false;
    }
    return true;
  }

  private appendLifecycle(
    action: SettlementRecordLifecycleEntry["action"],
    record: SettlementRecord,
    occurredAt: number,
  ): void {
    this.lifecycle.push({
      offset: this.lifecycle.length,
      action,
      recordId: record.id,
      settlementId: record.settlementId,
      status: record.status,
      occurredAt,
      record: this.cloneRecord(record),
    });
  }

  private cloneRecord(record: SettlementRecord): SettlementRecord {
    return {
      ...record,
      connectorMetadata: record.connectorMetadata ? { ...record.connectorMetadata } : undefined,
    };
  }

  private cloneLifecycleEntry(entry: SettlementRecordLifecycleEntry): SettlementRecordLifecycleEntry {
    return {
      ...entry,
      record: this.cloneRecord(entry.record),
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

  private normalizeOffset(value: number | undefined, label: string): number {
    if (value === undefined) {
      return 0;
    }
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`invalid ${label}: ${value}`);
    }
    return value;
  }

  private normalizeLimit(value: number | undefined, fallback: number, max: number): number {
    if (value === undefined) {
      return fallback;
    }
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`invalid limit: ${value}`);
    }
    return Math.min(value, max);
  }
}
