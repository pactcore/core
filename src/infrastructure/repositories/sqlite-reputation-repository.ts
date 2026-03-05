import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { ReputationRepository } from "../../application/contracts";
import type { ReputationRecord } from "../../domain/types";

export interface SQLiteReputationRepositoryOptions {
  filePath: string;
}

interface StoredReputationRow {
  record_json: string;
}

export class SQLiteReputationRepository implements ReputationRepository {
  private readonly db: Database;

  constructor(options: SQLiteReputationRepositoryOptions) {
    mkdirSync(dirname(options.filePath), { recursive: true });
    this.db = new Database(options.filePath);
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS reputations (
        participant_id TEXT PRIMARY KEY,
        record_json TEXT NOT NULL
      )
    `);
  }

  async save(record: ReputationRecord): Promise<void> {
    this.db.run(
      `
        INSERT INTO reputations (participant_id, record_json)
        VALUES (?, ?)
        ON CONFLICT(participant_id)
        DO UPDATE SET record_json = excluded.record_json
      `,
      record.participantId,
      JSON.stringify(record),
    );
  }

  async get(participantId: string): Promise<ReputationRecord | undefined> {
    const row = this.db
      .query<StoredReputationRow, [string]>(
        "SELECT record_json FROM reputations WHERE participant_id = ?",
      )
      .get(participantId);
    if (!row) {
      return undefined;
    }
    return this.parseReputation(row.record_json);
  }

  private parseReputation(serialized: string): ReputationRecord {
    return JSON.parse(serialized) as ReputationRecord;
  }
}
