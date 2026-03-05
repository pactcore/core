import type { ComputeProviderCapabilities } from "./types";

export interface ResourceTier {
  name: string;
  cpuCores: number;
  memoryMB: number;
  gpuCount?: number;
  pricePerHourCents: number;
}

export interface PricingTable {
  tiers: ResourceTier[];
}

// Prices are represented in cents/hour.
// Serverless is normalized from $0.00001/call.
export const defaultPricingTable: PricingTable = {
  tiers: [
    { name: "Serverless", cpuCores: 0, memoryMB: 0, pricePerHourCents: 0.001 },
    { name: "Container Small", cpuCores: 1, memoryMB: 2048, pricePerHourCents: 2 },
    { name: "Container Med", cpuCores: 2, memoryMB: 4096, pricePerHourCents: 4 },
    { name: "Container Large", cpuCores: 4, memoryMB: 8192, pricePerHourCents: 8 },
    { name: "VM Small", cpuCores: 2, memoryMB: 8192, pricePerHourCents: 6 },
    { name: "VM Med", cpuCores: 4, memoryMB: 16384, pricePerHourCents: 12 },
    { name: "VM Large", cpuCores: 8, memoryMB: 32768, pricePerHourCents: 24 },
    { name: "GPU T4", cpuCores: 8, memoryMB: 32768, gpuCount: 1, pricePerHourCents: 35 },
    { name: "GPU A100", cpuCores: 16, memoryMB: 65536, gpuCount: 1, pricePerHourCents: 180 },
  ],
};

export function calculateJobCost(tier: ResourceTier, durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 0;
  }

  const hours = durationSeconds / 3_600;
  return Number((tier.pricePerHourCents * hours).toFixed(6));
}

export function findBestTier(
  requirements: ComputeProviderCapabilities,
  pricingTable: PricingTable = defaultPricingTable,
): ResourceTier | undefined {
  const minGpu = requirements.gpuCount ?? 0;
  const candidates = pricingTable.tiers.filter((tier) => {
    if (tier.cpuCores < requirements.cpuCores) return false;
    if (tier.memoryMB < requirements.memoryMB) return false;
    if ((tier.gpuCount ?? 0) < minGpu) return false;
    return true;
  });

  if (candidates.length === 0) {
    return undefined;
  }

  const requiredModel = requirements.gpuModel?.trim().toLowerCase();
  const modelCandidates = requiredModel
    ? candidates.filter((tier) => tier.name.toLowerCase().includes(requiredModel))
    : [];
  const eligible = modelCandidates.length > 0 ? modelCandidates : candidates;

  return [...eligible].sort((a, b) => {
    if (a.pricePerHourCents !== b.pricePerHourCents) {
      return a.pricePerHourCents - b.pricePerHourCents;
    }
    if (a.cpuCores !== b.cpuCores) {
      return a.cpuCores - b.cpuCores;
    }
    if (a.memoryMB !== b.memoryMB) {
      return a.memoryMB - b.memoryMB;
    }
    return (a.gpuCount ?? 0) - (b.gpuCount ?? 0);
  })[0];
}
