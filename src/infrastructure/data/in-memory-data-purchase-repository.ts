import type { DataPurchaseRepository } from "../../application/contracts";
import type { DataPurchase } from "../../domain/data-marketplace";

export class InMemoryDataPurchaseRepository implements DataPurchaseRepository {
  private readonly purchases = new Map<string, DataPurchase>();

  async save(purchase: DataPurchase): Promise<void> {
    this.purchases.set(purchase.id, purchase);
  }

  async getById(id: string): Promise<DataPurchase | undefined> {
    return this.purchases.get(id);
  }

  async listByBuyer(buyerId: string): Promise<DataPurchase[]> {
    return [...this.purchases.values()].filter((purchase) => purchase.buyerId === buyerId);
  }

  async listByAsset(assetId: string): Promise<DataPurchase[]> {
    return [...this.purchases.values()].filter((purchase) => purchase.assetId === assetId);
  }
}
