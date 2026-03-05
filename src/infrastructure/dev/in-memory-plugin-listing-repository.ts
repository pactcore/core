import type { PluginListingRepository } from "../../application/contracts";
import type { PluginListing } from "../../domain/plugin-marketplace";

export class InMemoryPluginListingRepository implements PluginListingRepository {
  private readonly listings = new Map<string, PluginListing>();

  async save(listing: PluginListing): Promise<void> {
    this.listings.set(listing.id, listing);
  }

  async getById(id: string): Promise<PluginListing | undefined> {
    return this.listings.get(id);
  }

  async listByDeveloper(developerId: string): Promise<PluginListing[]> {
    return [...this.listings.values()].filter((listing) => listing.developerId === developerId);
  }

  async listActive(): Promise<PluginListing[]> {
    return [...this.listings.values()].filter((listing) => listing.active);
  }
}
