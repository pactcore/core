import type { PluginRevenueShareRepository } from "../../application/contracts";
import type { RevenueShare } from "../../domain/plugin-marketplace";

export class InMemoryPluginRevenueShareRepository implements PluginRevenueShareRepository {
  private readonly revenueShares = new Map<string, RevenueShare>();

  async save(revenueShare: RevenueShare): Promise<void> {
    this.revenueShares.set(revenueShare.id, revenueShare);
  }

  async listByPlugin(pluginId: string): Promise<RevenueShare[]> {
    return [...this.revenueShares.values()].filter((share) => share.pluginId === pluginId);
  }

  async listByDeveloper(developerId: string): Promise<RevenueShare[]> {
    return [...this.revenueShares.values()].filter((share) => share.developerId === developerId);
  }
}
