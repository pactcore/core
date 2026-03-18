import type { Database } from "bun:sqlite";
import type { DataListingRepository } from "../../application/contracts";
import type { DataCategory, DataListing } from "../../domain/data-marketplace";
import { openSQLiteDataDatabase } from "./sqlite-data-database";

export interface SQLiteDataListingRepositoryOptions {
  filePath: string;
}

interface StoredDataListingRow {
  listing_json: string;
}

export class SQLiteDataListingRepository implements DataListingRepository {
  readonly durability = "database" as const;

  private readonly db: Database;

  constructor(options: SQLiteDataListingRepositoryOptions) {
    this.db = openSQLiteDataDatabase(options.filePath);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS data_listings (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        seller_id TEXT NOT NULL,
        active INTEGER NOT NULL,
        listing_json TEXT NOT NULL
      )
    `);
    this.db.run("CREATE INDEX IF NOT EXISTS idx_data_listings_category ON data_listings (category)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_data_listings_seller_id ON data_listings (seller_id)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_data_listings_active ON data_listings (active)");
  }

  isDurable(): boolean {
    return true;
  }

  async save(listing: DataListing): Promise<void> {
    this.db.run(
      `
        INSERT INTO data_listings (id, category, seller_id, active, listing_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id)
        DO UPDATE SET
          category = excluded.category,
          seller_id = excluded.seller_id,
          active = excluded.active,
          listing_json = excluded.listing_json
      `,
      listing.id,
      listing.category,
      listing.sellerId,
      listing.active ? 1 : 0,
      JSON.stringify(listing),
    );
  }

  async getById(id: string): Promise<DataListing | undefined> {
    const row = this.db
      .query<StoredDataListingRow, [string]>("SELECT listing_json FROM data_listings WHERE id = ?")
      .get(id);
    return row ? (JSON.parse(row.listing_json) as DataListing) : undefined;
  }

  async listByCategory(category: DataCategory): Promise<DataListing[]> {
    const rows = this.db
      .query<StoredDataListingRow, [DataCategory]>(
        "SELECT listing_json FROM data_listings WHERE category = ? ORDER BY rowid ASC",
      )
      .all(category);
    return rows.map((row) => JSON.parse(row.listing_json) as DataListing);
  }

  async listBySeller(sellerId: string): Promise<DataListing[]> {
    const rows = this.db
      .query<StoredDataListingRow, [string]>(
        "SELECT listing_json FROM data_listings WHERE seller_id = ? ORDER BY rowid ASC",
      )
      .all(sellerId);
    return rows.map((row) => JSON.parse(row.listing_json) as DataListing);
  }

  async listActive(): Promise<DataListing[]> {
    const rows = this.db
      .query<StoredDataListingRow, []>(
        "SELECT listing_json FROM data_listings WHERE active = 1 ORDER BY rowid ASC",
      )
      .all();
    return rows.map((row) => JSON.parse(row.listing_json) as DataListing);
  }

  isDurable(): boolean {
    return true;
  }

  getHealth(): { name: string; state: string; checkedAt: number; durable: boolean; durability: string; features: Record<string, unknown> } {
    const total = this.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM data_listings")
      .get()?.count ?? 0;
    const active = this.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM data_listings WHERE active = 1")
      .get()?.count ?? 0;
    return {
      name: "data-listing-repository",
      state: "healthy",
      checkedAt: Date.now(),
      durable: true,
      durability: this.durability,
      features: {
        marketplace: true,
        listings: total,
        activeListings: active,
      },
    };
  }
}
