import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AdapterHealthReport } from "../../application/adapter-runtime";
import type { DataAssetMetadataStore } from "../../application/contracts";
import type { DataAsset } from "../../application/modules/pact-data";

interface StoredDataAssetState {
  assets: DataAsset[];
}

export interface FileBackedDataAssetMetadataStoreOptions {
  filePath: string;
}

export class FileBackedDataAssetMetadataStore implements DataAssetMetadataStore {
  readonly durability = "filesystem" as const;

  private readonly filePath: string;
  private readonly assets = new Map<string, DataAsset>();
  private readonly loaded: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();
  private lastError?: AdapterHealthReport["lastError"];

  constructor(options: FileBackedDataAssetMetadataStoreOptions) {
    this.filePath = options.filePath;
    this.loaded = this.loadFromDisk();
  }

  isDurable(): boolean {
    return true;
  }

  async save(asset: DataAsset): Promise<void> {
    await this.withWriteLock(async () => {
      this.assets.set(asset.id, cloneAsset(asset));
      await this.persistToDisk();
    });
  }

  async getById(id: string): Promise<DataAsset | undefined> {
    await this.loaded;
    const asset = this.assets.get(id);
    return asset ? cloneAsset(asset) : undefined;
  }

  async list(): Promise<DataAsset[]> {
    await this.loaded;
    return [...this.assets.values()].map((asset) => cloneAsset(asset));
  }

  getHealth(): AdapterHealthReport {
    return {
      name: "asset-metadata-store",
      state: this.lastError ? "degraded" : "healthy",
      checkedAt: Date.now(),
      durable: true,
      durability: this.durability,
      features: {
        persistedAssets: this.assets.size,
      },
      lastError: this.lastError,
    };
  }

  private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.loaded;

    const previous = this.writeQueue;
    let release: (() => void) | undefined;
    this.writeQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await fn();
    } catch (error) {
      this.lastError = {
        adapter: "data",
        operation: "persist_asset_metadata",
        code: "metadata_store_write_failed",
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
        occurredAt: Date.now(),
      };
      throw error;
    } finally {
      release?.();
    }
  }

  private async loadFromDisk(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") {
        return;
      }

      this.lastError = {
        adapter: "data",
        operation: "load_asset_metadata",
        code: "metadata_store_read_failed",
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
        occurredAt: Date.now(),
      };
      throw error;
    }

    const parsed = JSON.parse(raw) as Partial<StoredDataAssetState>;
    if (!Array.isArray(parsed.assets)) {
      return;
    }

    for (const candidate of parsed.assets) {
      if (!candidate || typeof candidate.id !== "string") {
        continue;
      }

      this.assets.set(candidate.id, cloneAsset(candidate));
    }
  }

  private async persistToDisk(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });

    const state: StoredDataAssetState = {
      assets: [...this.assets.values()].map((asset) => cloneAsset(asset)),
    };

    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
    await rename(tempPath, this.filePath);
  }
}

function cloneAsset(asset: DataAsset): DataAsset {
  return {
    ...asset,
    tags: [...asset.tags],
  };
}
