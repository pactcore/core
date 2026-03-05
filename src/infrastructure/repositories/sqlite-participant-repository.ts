import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { ParticipantRepository } from "../../application/contracts";
import type { Participant } from "../../domain/types";

export interface SQLiteParticipantRepositoryOptions {
  filePath: string;
}

interface StoredParticipantRow {
  participant_json: string;
}

export class SQLiteParticipantRepository implements ParticipantRepository {
  private readonly db: Database;

  constructor(options: SQLiteParticipantRepositoryOptions) {
    mkdirSync(dirname(options.filePath), { recursive: true });
    this.db = new Database(options.filePath);
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS participants (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        participant_json TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_participants_role ON participants (role)
    `);
  }

  async save(participant: Participant): Promise<void> {
    this.db.run(
      `
        INSERT INTO participants (id, role, participant_json)
        VALUES (?, ?, ?)
        ON CONFLICT(id)
        DO UPDATE SET
          role = excluded.role,
          participant_json = excluded.participant_json
      `,
      participant.id,
      participant.role,
      JSON.stringify(participant),
    );
  }

  async getById(id: string): Promise<Participant | undefined> {
    const row = this.db
      .query<StoredParticipantRow, [string]>("SELECT participant_json FROM participants WHERE id = ?")
      .get(id);
    if (!row) {
      return undefined;
    }
    return this.parseParticipant(row.participant_json);
  }

  async listByRole(role: Participant["role"]): Promise<Participant[]> {
    const rows = this.db
      .query<StoredParticipantRow, [Participant["role"]]>(
        "SELECT participant_json FROM participants WHERE role = ? ORDER BY rowid ASC",
      )
      .all(role);
    return rows.map((row) => this.parseParticipant(row.participant_json));
  }

  private parseParticipant(serialized: string): Participant {
    return JSON.parse(serialized) as Participant;
  }
}
