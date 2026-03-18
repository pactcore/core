import type { DataListingRepository } from "../../application/contracts";
import type { DataCategory, DataListing } from "../../domain/data-marketplace";

export class InMemoryDataListingRepository implements DataListingRepository {
  readonly durability = "memory" as const;

  private readonly listings = new Map<string, DataListing>();

  async save(listing: DataListing): Promise<void> {
    this.listings.set(listing.id, listing);
  }

  async getById(id: string): Promise<DataListing | undefined> {
    return this.listings.get(id);
  }

  async listByCategory(category: DataCategory): Promise<DataListing[]> {
    return [...this.listings.values()].filter((listing) => listing.category === category);
  }

  async listBySeller(sellerId: string): Promise<DataListing[]> {
    return [...this.listings.values()].filter((listing) => listing.sellerId === sellerId);
  }

  async listActive(): Promise<DataListing[]> {
    return [...this.listings.values()].filter((listing) => listing.active);
  }

  getHealth(): { name: string; state: string; checkedAt: number; durable: boolean; durability: string; features: Record<string, unknown> } {
    return {
      name: "data-listing-repository",
      state: "healthy",
      checkedAt: Date.now(),
      durable: false,
      durability: this.durability,
      features: {
        marketplace: true,
        listings: this.listings.size,
        activeListings: [...this.listings.values()].filter((listing) => listing.active).length,
      },
    };
  }
}
