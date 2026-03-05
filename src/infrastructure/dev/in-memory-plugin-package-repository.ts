import type { PluginPackageRepository } from "../../application/contracts";
import type { PluginPackage } from "../../domain/plugin-marketplace";

export class InMemoryPluginPackageRepository implements PluginPackageRepository {
  private readonly packages = new Map<string, PluginPackage>();

  async save(pkg: PluginPackage): Promise<void> {
    this.packages.set(pkg.id, pkg);
  }

  async getById(id: string): Promise<PluginPackage | undefined> {
    return this.packages.get(id);
  }

  async listByDeveloper(developerId: string): Promise<PluginPackage[]> {
    return [...this.packages.values()].filter((pkg) => pkg.developerId === developerId);
  }
}
