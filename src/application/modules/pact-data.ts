import { generateId } from "../utils";

export interface DataAsset {
  id: string;
  ownerId: string;
  title: string;
  uri: string;
  tags: string[];
  createdAt: number;
}

export interface PublishDataAssetInput {
  ownerId: string;
  title: string;
  uri: string;
  tags?: string[];
}

export class PactData {
  private readonly assets = new Map<string, DataAsset>();

  async publish(input: PublishDataAssetInput): Promise<DataAsset> {
    const asset: DataAsset = {
      id: generateId("data"),
      ownerId: input.ownerId,
      title: input.title,
      uri: input.uri,
      tags: input.tags ?? [],
      createdAt: Date.now(),
    };

    this.assets.set(asset.id, asset);
    return asset;
  }

  async list(): Promise<DataAsset[]> {
    return [...this.assets.values()];
  }
}
