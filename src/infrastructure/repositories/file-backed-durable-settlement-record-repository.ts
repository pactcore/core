import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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

interface StoredSettlementRecordState {
  records: SettlementRecord[];
  lifecycle: SettlementRecordLifecycleEntry[];
}

export interface FileBackedDurableSettlementRecordRepositoryOptions {
  filePath: string;
}

export class FileBackedDurableSettlementRecordRepository implements SettlementRecordRepository {
  private readonly filePath: string;
  private readonly records = new Map<string, SettlementRecord>();
  private lifecycle = new Array<SettlementRecordLifecycleEntry>();
  private readonly loaded: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: FileBackedDurableSettlementRecordRepositoryOptions) {
    this.filePath = options.filePath;
    this.loaded = this.loadFromDisk();
  }

  async append(record: SettlementRecord): Promise<void> {
    await this.withWriteLock(async () => {
      if (this.records.has(record.id)) {
        throw new Error(`settlement record already exists: ${record.id}`);
      }

      const snapshot = this.cloneRecord(record);
      this.records.set(snapshot.id, snapshot);
      this.appendLifecycle("created", snapshot, snapshot.createdAt);
      await this.persistToDisk();
    });
  }

  async getById(recordId: string): Promise<SettlementRecord | undefined> {
    await this.loaded;
    const record = this.records.get(recordId);
    return record ? this.cloneRecord(record) : undefined;
  }

  async query(
    filter?: SettlementRecordQueryFilter,
    page?: SettlementRecordPageRequest,
  ): Promise<SettlementRecordPage> {
    await this.loaded;

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
    return this.withWriteLock(async () => {
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
      await this.persistToDisk();
      return this.cloneRecord(next);
    });
  }

  async replay(request: SettlementRecordReplayRequest = {}): Promise<SettlementRecordReplayPage> {
    await this.loaded;
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

  private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.loaded;
    const previous = this.writeQueue;
    let release: (() => void) | undefined;
    this.writeQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await fn();
    } finally {
      release?.();
    }
  }

  private async loadFromDisk(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") {
        return;
      }
      throw error;
    }

    const parsed = JSON.parse(raw) as Partial<StoredSettlementRecordState>;
    if (Array.isArray(parsed.records)) {
      for (const candidate of parsed.records) {
        if (candidate && typeof candidate.id === "string") {
          this.records.set(candidate.id, this.cloneRecord(candidate));
        }
      }
    }

    if (Array.isArray(parsed.lifecycle)) {
      this.lifecycle = parsed.lifecycle
        .map((entry) => this.normalizeLifecycleEntry(entry))
        .filter((entry): entry is SettlementRecordLifecycleEntry => entry !== undefined)
        .map((entry, index) => ({ ...entry, offset: index }));
    }
  }

  private normalizeLifecycleEntry(
    entry: SettlementRecordLifecycleEntry,
  ): SettlementRecordLifecycleEntry | undefined {
    if (!entry || typeof entry !== "object") {
      return undefined;
    }

    const action = entry.action === "reconciled" ? "reconciled" : entry.action === "created" ? "created" : undefined;
    if (!action || !entry.record || typeof entry.record.id !== "string") {
      return undefined;
    }

    const record = this.cloneRecord(entry.record);
    const existing = this.records.get(record.id);
    const snapshot = existing ? this.cloneRecord(existing) : record;

    return {
      offset: 0,
      action,
      recordId: snapshot.id,
      settlementId: snapshot.settlementId,
      status: snapshot.status,
      occurredAt: typeof entry.occurredAt === "number" ? entry.occurredAt : snapshot.createdAt,
      record: snapshot,
    };
  }

  private async persistToDisk(): Promise<void> {
    const records = [...this.records.values()]
      .sort((a, b) => {
        if (a.createdAt === b.createdAt) {
          return a.id.localeCompare(b.id);
        }
        return a.createdAt - b.createdAt;
      })
      .map((record) => this.cloneRecord(record));

    const lifecycle = this.lifecycle.map((entry, index) => ({
      ...this.cloneLifecycleEntry(entry),
      offset: index,
    }));
    this.lifecycle = lifecycle;

    const state: StoredSettlementRecordState = {
      records,
      lifecycle,
    };

    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
    await rename(tempPath, this.filePath);
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
