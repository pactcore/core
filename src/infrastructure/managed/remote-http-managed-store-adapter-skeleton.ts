import type { ManagedBackendDomain } from "../../application/managed-backends";
import type {
  ManagedBackendHealthReport,
  ManagedBackendProfile,
  ManagedBackendStoreAdapter,
  ManagedStorePage,
  ManagedStorePutOptions,
  ManagedStoreQuery,
  ManagedStoreRecord,
} from "../../application/managed-backends";
import {
  cloneManagedBackendProfile,
  createRemoteManagedBackendHealth,
  REMOTE_MANAGED_BACKEND_DURABILITY,
} from "./remote-http-managed-backend-skeleton-helpers";

export interface RemoteHttpManagedStoreAdapterSkeletonOptions {
  domain: ManagedBackendDomain;
  profile: ManagedBackendProfile;
}

export class RemoteHttpManagedStoreAdapterSkeleton<TValue = unknown>
  implements ManagedBackendStoreAdapter<TValue>
{
  readonly capability = "store" as const;
  readonly mode = "remote" as const;
  readonly durability = REMOTE_MANAGED_BACKEND_DURABILITY;
  readonly domain: ManagedBackendDomain;

  private readonly profile: ManagedBackendProfile;
  private readonly records = new Map<string, ManagedStoreRecord<TValue>>();

  constructor(options: RemoteHttpManagedStoreAdapterSkeletonOptions) {
    this.domain = options.domain;
    this.profile = cloneManagedBackendProfile(options.profile);
  }

  async put(record: ManagedStoreRecord<TValue>, options?: ManagedStorePutOptions): Promise<void> {
    const existing = this.records.get(record.key);
    if (options?.expectedEtag !== undefined && existing?.etag !== options.expectedEtag) {
      throw new Error(`managed store etag mismatch for key ${record.key}`);
    }

    this.records.set(record.key, cloneRecord({
      ...record,
      etag: record.etag ?? await createManagedStoreEtag(record),
    }));
  }

  async get(key: string): Promise<ManagedStoreRecord<TValue> | undefined> {
    const record = this.records.get(key);
    return record ? cloneRecord(record) : undefined;
  }

  async list(query: ManagedStoreQuery = {}): Promise<ManagedStorePage<TValue>> {
    const prefix = query.prefix ?? "";
    const sortedKeys = [...this.records.keys()].sort((left, right) => left.localeCompare(right));
    const startIndex = query.cursor ? Math.max(sortedKeys.indexOf(query.cursor), -1) + 1 : 0;
    const limit = query.limit !== undefined && query.limit > 0 ? query.limit : sortedKeys.length;
    const items: ManagedStoreRecord<TValue>[] = [];
    let nextCursor: string | undefined;

    for (let index = startIndex; index < sortedKeys.length; index += 1) {
      const key = sortedKeys[index];
      if (!key?.startsWith(prefix)) {
        continue;
      }

      const record = this.records.get(key);
      if (!record) {
        continue;
      }

      items.push(cloneRecord(record));
      if (items.length === limit) {
        nextCursor = sortedKeys.slice(index + 1).some((candidate) => candidate.startsWith(prefix))
          ? key
          : undefined;
        break;
      }
    }

    return {
      items,
      nextCursor,
    };
  }

  async delete(key: string): Promise<boolean> {
    return this.records.delete(key);
  }

  getManagedHealth(): ManagedBackendHealthReport {
    return createRemoteManagedBackendHealth({
      domain: this.domain,
      capability: "store",
      profile: this.profile,
      missingFieldsOperation: "configure_remote_store",
      features: {
        managedStore: true,
        storedRecords: this.records.size,
        listSupport: true,
        deleteSupport: true,
      },
    });
  }
}

function cloneRecord<TValue>(record: ManagedStoreRecord<TValue>): ManagedStoreRecord<TValue> {
  return {
    ...record,
    metadata: record.metadata ? { ...record.metadata } : undefined,
  };
}

async function createManagedStoreEtag<TValue>(record: ManagedStoreRecord<TValue>): Promise<string> {
  const payload = JSON.stringify({
    key: record.key,
    value: record.value,
    updatedAt: record.updatedAt,
    metadata: record.metadata ?? undefined,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return `sha256:${bufferToHex(digest)}`;
}

function bufferToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
