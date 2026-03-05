import type {
  PluginInstallRepository,
  PluginListingRepository,
  PluginPackageRepository,
  PluginRevenueShareRepository,
} from "../contracts";
import type {
  PluginInstall,
  PluginListing,
  PluginPackage,
  RevenueShare,
} from "../../domain/plugin-marketplace";
import { calculateRevenueShare } from "../../domain/plugin-marketplace";
import { generateId } from "../utils";

export interface PublishPluginInput {
  developerId: string;
  name: string;
  version: string;
  description: string;
  repositoryUrl: string;
  priceCents: number;
}

export interface PluginListingView {
  package: PluginPackage;
  listing: PluginListing;
}

export class PactPluginMarketplace {
  constructor(
    private readonly packageRepository: PluginPackageRepository,
    private readonly listingRepository: PluginListingRepository,
    private readonly installRepository: PluginInstallRepository,
    private readonly revenueShareRepository: PluginRevenueShareRepository,
  ) {}

  async publishPlugin(input: PublishPluginInput): Promise<PluginListingView> {
    this.validatePublishInput(input);

    const now = Date.now();
    const pkg: PluginPackage = {
      id: generateId("pluginpkg"),
      developerId: input.developerId,
      name: input.name,
      version: input.version,
      description: input.description,
      repositoryUrl: input.repositoryUrl,
      createdAt: now,
      updatedAt: now,
    };

    const listing: PluginListing = {
      id: generateId("plugin"),
      packageId: pkg.id,
      developerId: input.developerId,
      priceCents: input.priceCents,
      currency: "USDC",
      publishedAt: now,
      active: true,
    };

    await this.packageRepository.save(pkg);
    await this.listingRepository.save(listing);

    return { package: pkg, listing };
  }

  async listPlugins(): Promise<PluginListingView[]> {
    const listings = await this.listingRepository.listActive();
    const views: PluginListingView[] = [];

    for (const listing of listings) {
      const pkg = await this.packageRepository.getById(listing.packageId);
      if (!pkg) {
        continue;
      }
      views.push({ package: pkg, listing });
    }

    return views;
  }

  async installPlugin(pluginId: string, installerId: string): Promise<PluginInstall> {
    if (!installerId) {
      throw new Error("installerId is required");
    }

    const listing = await this.requireListing(pluginId);
    if (!listing.active) {
      throw new Error(`Plugin ${pluginId} is not active`);
    }

    const install: PluginInstall = {
      id: generateId("plugin_install"),
      pluginId: listing.id,
      packageId: listing.packageId,
      installerId,
      installedAt: Date.now(),
    };

    await this.installRepository.save(install);
    return install;
  }

  async recordPluginRevenue(pluginId: string, grossRevenueCents: number): Promise<RevenueShare> {
    const listing = await this.requireListing(pluginId);
    const pkg = await this.packageRepository.getById(listing.packageId);
    if (!pkg) {
      throw new Error(`Plugin package ${listing.packageId} not found`);
    }

    const split = calculateRevenueShare(grossRevenueCents);
    const revenueShare: RevenueShare = {
      id: generateId("plugin_rev"),
      pluginId: listing.id,
      packageId: pkg.id,
      developerId: pkg.developerId,
      grossRevenueCents,
      developerPayoutCents: split.developerPayoutCents,
      protocolPayoutCents: split.protocolPayoutCents,
      recordedAt: Date.now(),
    };

    await this.revenueShareRepository.save(revenueShare);
    return revenueShare;
  }

  async getDeveloperPayouts(developerId: string): Promise<RevenueShare[]> {
    return this.revenueShareRepository.listByDeveloper(developerId);
  }

  private async requireListing(pluginId: string): Promise<PluginListing> {
    const listing = await this.listingRepository.getById(pluginId);
    if (!listing) {
      throw new Error(`Plugin ${pluginId} not found`);
    }
    return listing;
  }

  private validatePublishInput(input: PublishPluginInput): void {
    if (!input.developerId) {
      throw new Error("developerId is required");
    }
    if (!input.name) {
      throw new Error("name is required");
    }
    if (!input.version) {
      throw new Error("version is required");
    }
    if (!input.repositoryUrl) {
      throw new Error("repositoryUrl is required");
    }
    if (!Number.isInteger(input.priceCents) || input.priceCents < 0) {
      throw new Error("priceCents must be a non-negative integer number of cents");
    }
  }
}
