import type { Database } from "bun:sqlite";
import type { DataAccessPolicyRepository } from "../../application/contracts";
import type { DataAccessPolicy } from "../../domain/types";
import { openSQLiteDataDatabase } from "./sqlite-data-database";

export interface SQLiteDataAccessPolicyRepositoryOptions {
  filePath: string;
}

interface StoredDataAccessPolicyRow {
  policy_json: string;
}

export class SQLiteDataAccessPolicyRepository implements DataAccessPolicyRepository {
  readonly durability = "database" as const;

  private readonly db: Database;

  constructor(options: SQLiteDataAccessPolicyRepositoryOptions) {
    this.db = openSQLiteDataDatabase(options.filePath);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS data_access_policies (
        asset_id TEXT PRIMARY KEY,
        policy_json TEXT NOT NULL
      )
    `);
  }

  isDurable(): boolean {
    return true;
  }

  async save(policy: DataAccessPolicy): Promise<void> {
    this.db.run(
      `
        INSERT INTO data_access_policies (asset_id, policy_json)
        VALUES (?, ?)
        ON CONFLICT(asset_id)
        DO UPDATE SET policy_json = excluded.policy_json
      `,
      policy.assetId,
      JSON.stringify(policy),
    );
  }

  async getByAsset(assetId: string): Promise<DataAccessPolicy | undefined> {
    const row = this.db
      .query<StoredDataAccessPolicyRow, [string]>(
        "SELECT policy_json FROM data_access_policies WHERE asset_id = ?",
      )
      .get(assetId);
    return row ? (JSON.parse(row.policy_json) as DataAccessPolicy) : undefined;
  }

  getHealth(): { name: string; state: string; checkedAt: number; durable: boolean; durability: string; features: Record<string, unknown> } {
    const count = this.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM data_access_policies")
      .get()?.count ?? 0;
    return {
      name: "access-policy-repository",
      state: "healthy",
      checkedAt: Date.now(),
      durable: true,
      durability: this.durability,
      features: {
        accessControl: true,
        policies: count,
      },
    };
  }
}
