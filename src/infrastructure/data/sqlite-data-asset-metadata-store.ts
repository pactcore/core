import type { Database } from "bun:sqlite";
import type { AdapterHealthReport } from "../../application/adapter-runtime";
import type { DataAssetMetadataStore } from "../../application/contracts";
import type { DataAsset } from "../../application/modules/pact-data";
import { openSQLiteDataDatabase } from "./sqlite-data-database";

export interface SQLiteDataAssetMetadataStoreOptions {
  filePath: string;
}

interface StoredDataAssetRow {
  asset_json: string;
}

export class SQLiteDataAssetMetadataStore implements DataAssetMetadataStore {
  readonly durability = "database" as const;

  private readonly db: Database;
  private lastError?: AdapterHealthReport["lastError"];

  constructor(options: SQLiteDataAssetMetadataStoreOptions) {
    this.db = openSQLiteDataDatabase(options.filePath);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS data_assets (
        id TEXT PRIMARY KEY,
        asset_json TEXT NOT NULL
      )
    `);
  }

  isDurable(): boolean {
    return true;
  }

  async save(asset: DataAsset): Promise<void> {
    try {
      this.db.run(
        `
          INSERT INTO data_assets (id, asset_json)
          VALUES (?, ?)
          ON CONFLICT(id)
          DO UPDATE SET asset_json = excluded.asset_json
        `,
        asset.id,
        JSON.stringify(asset),
      );
      this.lastError = undefined;
    } catch (error) {
      this.lastError = toAdapterError("persist_asset_metadata", "metadata_store_write_failed", error);
      throw error;
    }
  }

  async getById(id: string): Promise<DataAsset | undefined> {
    try {
      const row = this.db
        .query<StoredDataAssetRow, [string]>("SELECT asset_json FROM data_assets WHERE id = ?")
        .get(id);
      this.lastError = undefined;
      return row ? this.parseAsset(row.asset_json) : undefined;
    } catch (error) {
      this.lastError = toAdapterError("load_asset_metadata", "metadata_store_read_failed", error);
      throw error;
    }
  }

  async list(): Promise<DataAsset[]> {
    try {
      const rows = this.db
        .query<StoredDataAssetRow, []>("SELECT asset_json FROM data_assets ORDER BY rowid ASC")
        .all();
      this.lastError = undefined;
      return rows.map((row) => this.parseAsset(row.asset_json));
    } catch (error) {
      this.lastError = toAdapterError("list_asset_metadata", "metadata_store_read_failed", error);
      throw error;
    }
  }

  getHealth(): AdapterHealthReport {
    const count = this.db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM data_assets").get()?.count ?? 0;
    return {
      name: "asset-metadata-store",
      state: this.lastError ? "degraded" : "healthy",
      checkedAt: Date.now(),
      durable: true,
      durability: this.durability,
      features: {
        persistedAssets: count,
      },
      lastError: this.lastError,
    };
  }

  private parseAsset(serialized: string): DataAsset {
    return JSON.parse(serialized) as DataAsset;
  }
}

function toAdapterError(
  operation: string,
  code: string,
  error: unknown,
): AdapterHealthReport["lastError"] {
  return {
    adapter: "data",
    operation,
    code,
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
    occurredAt: Date.now(),
  };
}
