import type { DataAssetRepository } from "../../application/contracts";
import type { DataAsset } from "../../application/modules/pact-data";

export class InMemoryDataAssetRepository implements DataAssetRepository {
  private readonly assets = new Map<string, DataAsset>();

  async save(asset: DataAsset): Promise<void> {
    this.assets.set(asset.id, asset);
  }

  async getById(id: string): Promise<DataAsset | undefined> {
    return this.assets.get(id);
  }

  async list(): Promise<DataAsset[]> {
    return [...this.assets.values()];
  }
}
