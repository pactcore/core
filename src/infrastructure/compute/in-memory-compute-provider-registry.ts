import type { ComputeProviderRegistry } from "../../application/contracts";
import type { ComputeProvider } from "../../domain/types";

export class InMemoryComputeProviderRegistry implements ComputeProviderRegistry {
  private readonly providers = new Map<string, ComputeProvider>();

  async registerProvider(provider: ComputeProvider): Promise<void> {
    this.providers.set(provider.id, provider);
  }

  async getProvider(id: string): Promise<ComputeProvider | undefined> {
    return this.providers.get(id);
  }

  async listProviders(): Promise<ComputeProvider[]> {
    return [...this.providers.values()];
  }

  async findProvidersByCapability(
    minCpu: number,
    minMemory: number,
    minGpu?: number,
  ): Promise<ComputeProvider[]> {
    return [...this.providers.values()].filter((p) => {
      if (p.status !== "available") return false;
      if (p.capabilities.cpuCores < minCpu) return false;
      if (p.capabilities.memoryMB < minMemory) return false;
      if (minGpu !== undefined && p.capabilities.gpuCount < minGpu) return false;
      return true;
    });
  }
}
