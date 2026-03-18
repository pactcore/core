import type { DataAccessPolicyRepository } from "../../application/contracts";
import type { DataAccessPolicy } from "../../domain/types";

export class InMemoryDataAccessPolicyRepository implements DataAccessPolicyRepository {
  readonly durability = "memory" as const;

  private readonly policies = new Map<string, DataAccessPolicy>();

  isDurable(): boolean {
    return false;
  }

  async save(policy: DataAccessPolicy): Promise<void> {
    this.policies.set(policy.assetId, policy);
  }

  async getByAsset(assetId: string): Promise<DataAccessPolicy | undefined> {
    return this.policies.get(assetId);
  }

  getHealth(): { name: string; state: string; checkedAt: number; durable: boolean; durability: string; features: Record<string, unknown> } {
    return {
      name: "access-policy-repository",
      state: "healthy",
      checkedAt: Date.now(),
      durable: false,
      durability: this.durability,
      features: {
        accessControl: true,
        policies: this.policies.size,
      },
    };
  }
}
