export interface PluginPackage {
  id: string;
  developerId: string;
  name: string;
  version: string;
  description: string;
  repositoryUrl: string;
  createdAt: number;
  updatedAt: number;
}

export interface PluginListing {
  id: string;
  packageId: string;
  developerId: string;
  priceCents: number;
  currency: "USDC";
  publishedAt: number;
  active: boolean;
}

export interface PluginInstall {
  id: string;
  pluginId: string;
  packageId: string;
  installerId: string;
  installedAt: number;
}

export interface RevenueShare {
  id: string;
  pluginId: string;
  packageId: string;
  developerId: string;
  grossRevenueCents: number;
  developerPayoutCents: number;
  protocolPayoutCents: number;
  recordedAt: number;
}

export function calculateRevenueShare(grossRevenueCents: number): {
  developerPayoutCents: number;
  protocolPayoutCents: number;
} {
  if (!Number.isInteger(grossRevenueCents) || grossRevenueCents <= 0) {
    throw new Error("Revenue must be a positive integer number of cents");
  }

  const developerPayoutCents = Math.floor((grossRevenueCents * 80) / 100);
  const protocolPayoutCents = grossRevenueCents - developerPayoutCents;

  return {
    developerPayoutCents,
    protocolPayoutCents,
  };
}
