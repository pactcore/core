import type { PluginInstallRepository } from "../../application/contracts";
import type { PluginInstall } from "../../domain/plugin-marketplace";

export class InMemoryPluginInstallRepository implements PluginInstallRepository {
  private readonly installs = new Map<string, PluginInstall>();

  async save(install: PluginInstall): Promise<void> {
    this.installs.set(install.id, install);
  }

  async listByPlugin(pluginId: string): Promise<PluginInstall[]> {
    return [...this.installs.values()].filter((install) => install.pluginId === pluginId);
  }

  async listByInstaller(installerId: string): Promise<PluginInstall[]> {
    return [...this.installs.values()].filter((install) => install.installerId === installerId);
  }
}
