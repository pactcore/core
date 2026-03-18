import type { Database } from "bun:sqlite";
import type { IntegrityProofRepository } from "../../application/contracts";
import type { IntegrityProof } from "../../domain/types";
import { openSQLiteDataDatabase } from "./sqlite-data-database";

export interface SQLiteIntegrityProofRepositoryOptions {
  filePath: string;
}

interface StoredIntegrityProofRow {
  proof_json: string;
}

export class SQLiteIntegrityProofRepository implements IntegrityProofRepository {
  readonly durability = "database" as const;

  private readonly db: Database;

  constructor(options: SQLiteIntegrityProofRepositoryOptions) {
    this.db = openSQLiteDataDatabase(options.filePath);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS data_integrity_proofs (
        asset_id TEXT PRIMARY KEY,
        proof_json TEXT NOT NULL
      )
    `);
  }

  isDurable(): boolean {
    return true;
  }

  async save(proof: IntegrityProof): Promise<void> {
    this.db.run(
      `
        INSERT INTO data_integrity_proofs (asset_id, proof_json)
        VALUES (?, ?)
        ON CONFLICT(asset_id)
        DO UPDATE SET proof_json = excluded.proof_json
      `,
      proof.assetId,
      JSON.stringify(proof),
    );
  }

  async getByAsset(assetId: string): Promise<IntegrityProof | undefined> {
    const row = this.db
      .query<StoredIntegrityProofRow, [string]>(
        "SELECT proof_json FROM data_integrity_proofs WHERE asset_id = ?",
      )
      .get(assetId);
    return row ? (JSON.parse(row.proof_json) as IntegrityProof) : undefined;
  }

  getHealth(): { name: string; state: string; checkedAt: number; durable: boolean; durability: string; features: Record<string, unknown> } {
    const count = this.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM data_integrity_proofs")
      .get()?.count ?? 0;
    return {
      name: "integrity-proof-repository",
      state: "healthy",
      checkedAt: Date.now(),
      durable: true,
      durability: this.durability,
      features: {
        integrityVerification: true,
        proofs: count,
      },
    };
  }
}
