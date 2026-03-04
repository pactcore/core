import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DomainEvent, EventJournal, EventJournalRecord } from "../../application/contracts";

const DEFAULT_REPLAY_LIMIT = 100;
const MAX_REPLAY_LIMIT = 500;

interface StoredEventJournalState {
  records: EventJournalRecord[];
}

export interface FileBackedEventJournalOptions {
  filePath: string;
}

export class FileBackedEventJournal implements EventJournal {
  private readonly filePath: string;
  private records = new Array<EventJournalRecord>();
  private readonly loaded: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: FileBackedEventJournalOptions) {
    this.filePath = options.filePath;
    this.loaded = this.loadFromDisk();
  }

  async append(event: DomainEvent<unknown>): Promise<EventJournalRecord> {
    return this.withWriteLock(async () => {
      const record: EventJournalRecord = {
        offset: this.records.length,
        event: this.cloneEvent(event),
      };

      this.records.push(record);
      await this.persistToDisk();
      return this.cloneRecord(record);
    });
  }

  async replay(fromOffset = 0, limit = DEFAULT_REPLAY_LIMIT): Promise<EventJournalRecord[]> {
    await this.loaded;
    const normalizedOffset = this.normalizeFromOffset(fromOffset);
    const normalizedLimit = this.normalizeLimit(limit);

    return this.records
      .slice(normalizedOffset, normalizedOffset + normalizedLimit)
      .map((record) => this.cloneRecord(record));
  }

  async latestOffset(): Promise<number> {
    await this.loaded;
    return this.records.length - 1;
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

    const parsed = JSON.parse(raw) as Partial<StoredEventJournalState> | EventJournalRecord[];
    const stored = Array.isArray(parsed) ? parsed : parsed.records;

    if (!Array.isArray(stored)) {
      return;
    }

    this.records = stored
      .map((candidate, index) => this.normalizeRecord(candidate, index))
      .filter((record): record is EventJournalRecord => record !== undefined);
  }

  private normalizeRecord(candidate: EventJournalRecord, offset: number): EventJournalRecord | undefined {
    if (!candidate || typeof candidate !== "object") {
      return undefined;
    }

    if (!candidate.event || typeof candidate.event.name !== "string") {
      return undefined;
    }

    const createdAt = typeof candidate.event.createdAt === "number" ? candidate.event.createdAt : Date.now();

    return {
      offset,
      event: {
        name: candidate.event.name,
        payload: candidate.event.payload,
        createdAt,
      },
    };
  }

  private async persistToDisk(): Promise<void> {
    const records = this.records.map((record, offset) => ({
      offset,
      event: this.cloneEvent(record.event),
    }));

    this.records = records;

    const state: StoredEventJournalState = {
      records,
    };

    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
    await rename(tempPath, this.filePath);
  }

  private cloneRecord(record: EventJournalRecord): EventJournalRecord {
    return {
      offset: record.offset,
      event: this.cloneEvent(record.event),
    };
  }

  private cloneEvent(event: DomainEvent<unknown>): DomainEvent<unknown> {
    return {
      name: event.name,
      payload: event.payload === undefined ? undefined : structuredClone(event.payload),
      createdAt: event.createdAt,
    };
  }

  private normalizeFromOffset(value: number): number {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`invalid fromOffset: ${value}`);
    }
    return value;
  }

  private normalizeLimit(value: number): number {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`invalid limit: ${value}`);
    }
    return Math.min(value, MAX_REPLAY_LIMIT);
  }
}
