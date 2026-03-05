import { generateId } from "../../application/utils";
import type { ApiKeyInfo, ApiKeyValidator } from "../../api/middleware/api-key-auth";

interface StoredApiKey extends ApiKeyInfo {
  key: string;
  createdAt: number;
  revoked: boolean;
}

export interface RegisteredApiKey {
  id: string;
  key: string;
}

export class InMemoryApiKeyStore implements ApiKeyValidator {
  private readonly keysById = new Map<string, StoredApiKey>();
  private readonly idByKey = new Map<string, string>();

  registerKey(ownerId: string, permissions: string[], rateLimit?: number): RegisteredApiKey {
    const id = generateId("api");
    const key = `pact_${crypto.randomUUID().replaceAll("-", "")}`;
    const stored: StoredApiKey = {
      id,
      key,
      ownerId,
      permissions: [...permissions],
      rateLimit,
      createdAt: Date.now(),
      revoked: false,
    };

    this.keysById.set(id, stored);
    this.idByKey.set(key, id);

    return { id, key };
  }

  async validateKey(key: string): Promise<ApiKeyInfo | null> {
    const id = this.idByKey.get(key);
    if (!id) {
      return null;
    }

    const stored = this.keysById.get(id);
    if (!stored || stored.revoked) {
      return null;
    }

    return toApiKeyInfo(stored);
  }

  revokeKey(id: string): boolean {
    const stored = this.keysById.get(id);
    if (!stored || stored.revoked) {
      return false;
    }

    stored.revoked = true;
    this.idByKey.delete(stored.key);
    return true;
  }

  listKeys(ownerId: string): ApiKeyInfo[] {
    const result: ApiKeyInfo[] = [];
    for (const stored of this.keysById.values()) {
      if (stored.ownerId !== ownerId || stored.revoked) {
        continue;
      }
      result.push(toApiKeyInfo(stored));
    }
    return result;
  }

  hasKeys(): boolean {
    for (const stored of this.keysById.values()) {
      if (!stored.revoked) {
        return true;
      }
    }
    return false;
  }
}

function toApiKeyInfo(stored: StoredApiKey): ApiKeyInfo {
  return {
    id: stored.id,
    ownerId: stored.ownerId,
    permissions: [...stored.permissions],
    rateLimit: stored.rateLimit,
  };
}
