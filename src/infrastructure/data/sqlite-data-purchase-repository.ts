import type { Database } from "bun:sqlite";
import type { DataPurchaseRepository } from "../../application/contracts";
import type { DataPurchase } from "../../domain/data-marketplace";
import { openSQLiteDataDatabase } from "./sqlite-data-database";

export interface SQLiteDataPurchaseRepositoryOptions {
  filePath: string;
}

interface StoredDataPurchaseRow {
  purchase_json: string;
}

export class SQLiteDataPurchaseRepository implements DataPurchaseRepository {
  readonly durability = "database" as const;

  private readonly db: Database;

  constructor(options: SQLiteDataPurchaseRepositoryOptions) {
    this.db = openSQLiteDataDatabase(options.filePath);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS data_purchases (
        id TEXT PRIMARY KEY,
        buyer_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        purchase_json TEXT NOT NULL
      )
    `);
    this.db.run("CREATE INDEX IF NOT EXISTS idx_data_purchases_buyer_id ON data_purchases (buyer_id)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_data_purchases_asset_id ON data_purchases (asset_id)");
  }

  async save(purchase: DataPurchase): Promise<void> {
    this.db.run(
      `
        INSERT INTO data_purchases (id, buyer_id, asset_id, purchase_json)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id)
        DO UPDATE SET
          buyer_id = excluded.buyer_id,
          asset_id = excluded.asset_id,
          purchase_json = excluded.purchase_json
      `,
      purchase.id,
      purchase.buyerId,
      purchase.assetId,
      JSON.stringify(purchase),
    );
  }

  async getById(id: string): Promise<DataPurchase | undefined> {
    const row = this.db
      .query<StoredDataPurchaseRow, [string]>("SELECT purchase_json FROM data_purchases WHERE id = ?")
      .get(id);
    return row ? (JSON.parse(row.purchase_json) as DataPurchase) : undefined;
  }

  async listByBuyer(buyerId: string): Promise<DataPurchase[]> {
    const rows = this.db
      .query<StoredDataPurchaseRow, [string]>(
        "SELECT purchase_json FROM data_purchases WHERE buyer_id = ? ORDER BY rowid ASC",
      )
      .all(buyerId);
    return rows.map((row) => JSON.parse(row.purchase_json) as DataPurchase);
  }

  async listByAsset(assetId: string): Promise<DataPurchase[]> {
    const rows = this.db
      .query<StoredDataPurchaseRow, [string]>(
        "SELECT purchase_json FROM data_purchases WHERE asset_id = ? ORDER BY rowid ASC",
      )
      .all(assetId);
    return rows.map((row) => JSON.parse(row.purchase_json) as DataPurchase);
  }

  isDurable(): boolean {
    return true;
  }

  getHealth(): { name: string; state: string; checkedAt: number; durable: boolean; durability: string; features: Record<string, unknown> } {
    const count = this.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM data_purchases")
      .get()?.count ?? 0;
    return {
      name: "data-purchase-repository",
      state: "healthy",
      checkedAt: Date.now(),
      durable: true,
      durability: this.durability,
      features: {
        marketplace: true,
        purchases: count,
      },
    };
  }
}
