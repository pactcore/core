import type { DataAccessPolicyRepository } from "../../application/contracts";
import type { DataAccessPolicy } from "../../domain/types";

export class InMemoryDataAccessPolicyRepository implements DataAccessPolicyRepository {
  private readonly policies = new Map<string, DataAccessPolicy>();

  async save(policy: DataAccessPolicy): Promise<void> {
    this.policies.set(policy.assetId, policy);
  }

  async getByAsset(assetId: string): Promise<DataAccessPolicy | undefined> {
    return this.policies.get(assetId);
  }
}
