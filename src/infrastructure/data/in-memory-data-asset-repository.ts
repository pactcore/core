import type { AdapterHealthReport } from "../../application/adapter-runtime";
import type { DataAssetMetadataStore } from "../../application/contracts";
import type { DataAsset } from "../../application/modules/pact-data";

export class InMemoryDataAssetRepository implements DataAssetMetadataStore {
  readonly durability = "memory" as const;

  private readonly assets = new Map<string, DataAsset>();

  isDurable(): boolean {
    return false;
  }

  async save(asset: DataAsset): Promise<void> {
    this.assets.set(asset.id, asset);
  }

  async getById(id: string): Promise<DataAsset | undefined> {
    return this.assets.get(id);
  }

  async list(): Promise<DataAsset[]> {
    return [...this.assets.values()];
  }

  getHealth(): AdapterHealthReport {
    return {
      name: "asset-metadata-store",
      state: "degraded",
      checkedAt: Date.now(),
      durable: false,
      durability: this.durability,
      features: {
        persistedAssets: this.assets.size,
      },
    };
  }
}
