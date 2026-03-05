import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { DomainEvent, EventJournal, EventJournalRecord } from "../../application/contracts";

const DEFAULT_REPLAY_LIMIT = 100;
const MAX_REPLAY_LIMIT = 500;

export interface SQLiteEventJournalOptions {
  filePath: string;
}

interface NextOffsetRow {
  next_offset: number;
}

interface LatestOffsetRow {
  latest_offset: number | null;
}

interface StoredEventRecordRow {
  offset: number;
  name: string;
  payload_json: string | null;
  created_at: number;
}

export class SQLiteEventJournal implements EventJournal {
  private readonly db: Database;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: SQLiteEventJournalOptions) {
    mkdirSync(dirname(options.filePath), { recursive: true });
    this.db = new Database(options.filePath);
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS event_journal (
        offset INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        payload_json TEXT,
        created_at INTEGER NOT NULL
      )
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_event_journal_created_at
      ON event_journal (created_at)
    `);
  }

  async append(event: DomainEvent<unknown>): Promise<EventJournalRecord> {
    return this.withWriteLock(async () => {
      const row = this.db
        .query<NextOffsetRow, []>(
          "SELECT COALESCE(MAX(offset), -1) + 1 AS next_offset FROM event_journal",
        )
        .get();
      const offset = row?.next_offset ?? 0;
      const snapshot = this.cloneEvent(event);
      const payloadJson = snapshot.payload === undefined ? null : JSON.stringify(snapshot.payload);

      this.db.run(
        `
          INSERT INTO event_journal (offset, name, payload_json, created_at)
          VALUES (?, ?, ?, ?)
        `,
        offset,
        snapshot.name,
        payloadJson,
        snapshot.createdAt,
      );

      return {
        offset,
        event: this.cloneEvent(snapshot),
      };
    });
  }

  async replay(fromOffset = 0, limit = DEFAULT_REPLAY_LIMIT): Promise<EventJournalRecord[]> {
    const normalizedOffset = this.normalizeFromOffset(fromOffset);
    const normalizedLimit = this.normalizeLimit(limit);
    const rows = this.db
      .query<StoredEventRecordRow, [number, number]>(
        `
          SELECT offset, name, payload_json, created_at
          FROM event_journal
          WHERE offset >= ?
          ORDER BY offset ASC
          LIMIT ?
        `,
      )
      .all(normalizedOffset, normalizedLimit);

    return rows.map((row) =>
      this.cloneRecord({
        offset: row.offset,
        event: {
          name: row.name,
          payload: row.payload_json === null ? undefined : JSON.parse(row.payload_json),
          createdAt: row.created_at,
        },
      }),
    );
  }

  async latestOffset(): Promise<number> {
    const row = this.db
      .query<LatestOffsetRow, []>("SELECT MAX(offset) AS latest_offset FROM event_journal")
      .get();
    return row?.latest_offset ?? -1;
  }

  private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
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
