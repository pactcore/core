import type {
  DataAccessPolicyRepository,
  DataAssetRepository,
  DataListingRepository,
  DataPurchaseRepository,
  IntegrityProofRepository,
  ProvenanceGraph,
} from "../contracts";
import type { DataAccessPolicy, IntegrityProof } from "../../domain/types";
import type {
  DataCategory,
  DataListing,
  DataMarketplaceStats,
  DataPurchase,
} from "../../domain/data-marketplace";
import { calculateRevenueDistribution } from "../../domain/data-marketplace";
import { generateId } from "../utils";

export interface DataAsset {
  id: string;
  ownerId: string;
  title: string;
  uri: string;
  tags: string[];
  createdAt: number;
}

export interface PublishDataAssetInput {
  ownerId: string;
  title: string;
  uri: string;
  tags?: string[];
  derivedFrom?: string[];
}

const DATA_CATEGORIES: DataCategory[] = [
  "geolocation",
  "image_video",
  "survey",
  "sensor",
  "labeled",
  "other",
];

export class PactData {
  constructor(
    private readonly assetRepository: DataAssetRepository,
    private readonly provenanceGraph: ProvenanceGraph,
    private readonly integrityProofRepository: IntegrityProofRepository,
    private readonly accessPolicyRepository: DataAccessPolicyRepository,
    private readonly listingRepository?: DataListingRepository,
    private readonly purchaseRepository?: DataPurchaseRepository,
  ) {}

  // ── Asset publishing ───────────────────────────────────────

  async publish(input: PublishDataAssetInput): Promise<DataAsset> {
    const asset: DataAsset = {
      id: generateId("data"),
      ownerId: input.ownerId,
      title: input.title,
      uri: input.uri,
      tags: input.tags ?? [],
      createdAt: Date.now(),
    };

    await this.assetRepository.save(asset);

    // Auto-create provenance edges
    if (input.derivedFrom) {
      for (const parentId of input.derivedFrom) {
        await this.provenanceGraph.addEdge({
          childId: asset.id,
          parentId,
          relationship: "derived_from",
          createdAt: Date.now(),
        });
      }
    }

    // Default access policy: public
    await this.accessPolicyRepository.save({
      assetId: asset.id,
      allowedParticipantIds: [input.ownerId],
      isPublic: true,
    });

    return asset;
  }

  async list(): Promise<DataAsset[]> {
    return this.assetRepository.list();
  }

  async getById(id: string): Promise<DataAsset | undefined> {
    return this.assetRepository.getById(id);
  }

  // ── Provenance ─────────────────────────────────────────────

  async getLineage(assetId: string) {
    return this.provenanceGraph.getLineage(assetId);
  }

  async getDependents(assetId: string) {
    return this.provenanceGraph.getDependents(assetId);
  }

  // ── Integrity proofs ───────────────────────────────────────

  async registerIntegrityProof(assetId: string, contentHash: string): Promise<IntegrityProof> {
    const proof: IntegrityProof = {
      assetId,
      algorithm: "sha-256",
      hash: contentHash,
      provenAt: Date.now(),
    };
    await this.integrityProofRepository.save(proof);
    return proof;
  }

  async verifyIntegrity(assetId: string, contentHash: string): Promise<boolean> {
    const proof = await this.integrityProofRepository.getByAsset(assetId);
    if (!proof) return false;
    return proof.hash === contentHash;
  }

  // ── Access control ─────────────────────────────────────────

  async setAccessPolicy(
    assetId: string,
    allowedParticipantIds: string[],
    isPublic: boolean,
  ): Promise<DataAccessPolicy> {
    const policy: DataAccessPolicy = { assetId, allowedParticipantIds, isPublic };
    await this.accessPolicyRepository.save(policy);
    return policy;
  }

  async checkAccess(assetId: string, participantId: string): Promise<boolean> {
    const policy = await this.accessPolicyRepository.getByAsset(assetId);
    if (!policy) return false;
    if (policy.isPublic) return true;
    return policy.allowedParticipantIds.includes(participantId);
  }

  // ── Marketplace ─────────────────────────────────────────────

  async listAsset(assetId: string, priceCents: number, category: DataCategory): Promise<DataListing> {
    if (!Number.isInteger(priceCents) || priceCents <= 0) {
      throw new Error("Listing price must be a positive integer number of cents");
    }

    const asset = await this.assetRepository.getById(assetId);
    if (!asset) {
      throw new Error(`Asset ${assetId} not found`);
    }

    const listing: DataListing = {
      id: generateId("listing"),
      assetId,
      sellerId: asset.ownerId,
      priceCents,
      currency: "USDC",
      category,
      listedAt: Date.now(),
      active: true,
    };

    await this.getListingRepository().save(listing);
    return listing;
  }

  async delistAsset(listingId: string): Promise<void> {
    const listingRepository = this.getListingRepository();
    const listing = await listingRepository.getById(listingId);
    if (!listing) {
      throw new Error(`Listing ${listingId} not found`);
    }

    await listingRepository.save({
      ...listing,
      active: false,
    });
  }

  async purchaseAsset(listingId: string, buyerId: string): Promise<DataPurchase> {
    const listingRepository = this.getListingRepository();
    const purchaseRepository = this.getPurchaseRepository();
    const listing = await listingRepository.getById(listingId);
    if (!listing) {
      throw new Error(`Listing ${listingId} not found`);
    }
    if (!listing.active) {
      throw new Error(`Listing ${listingId} is not active`);
    }

    const distribution = calculateRevenueDistribution(listing.priceCents);
    const purchase: DataPurchase = {
      id: generateId("purchase"),
      listingId: listing.id,
      assetId: listing.assetId,
      buyerId,
      priceCents: listing.priceCents,
      revenueDistribution: distribution,
      purchasedAt: Date.now(),
    };

    await purchaseRepository.save(purchase);
    await this.grantBuyerAccess(listing.assetId, buyerId);
    return purchase;
  }

  async getMarketplaceStats(): Promise<DataMarketplaceStats> {
    const listingRepository = this.getListingRepository();
    const purchaseRepository = this.getPurchaseRepository();

    const listingMap = new Map<string, DataListing>();
    for (const category of DATA_CATEGORIES) {
      const listings = await listingRepository.listByCategory(category);
      for (const listing of listings) {
        listingMap.set(listing.id, listing);
      }
    }

    const purchaseMap = new Map<string, DataPurchase>();
    const listedAssetIds = new Set([...listingMap.values()].map((listing) => listing.assetId));
    for (const assetId of listedAssetIds) {
      const purchases = await purchaseRepository.listByAsset(assetId);
      for (const purchase of purchases) {
        purchaseMap.set(purchase.id, purchase);
      }
    }

    const totalRevenueCents = [...purchaseMap.values()].reduce(
      (sum, purchase) => sum + purchase.priceCents,
      0,
    );

    return {
      totalListings: listingMap.size,
      totalPurchases: purchaseMap.size,
      totalRevenueCents,
    };
  }

  async listMarketplace(category?: DataCategory): Promise<DataListing[]> {
    const listingRepository = this.getListingRepository();
    if (category) {
      const listings = await listingRepository.listByCategory(category);
      return listings.filter((listing) => listing.active);
    }
    return listingRepository.listActive();
  }

  private getListingRepository(): DataListingRepository {
    if (!this.listingRepository) {
      throw new Error("Data listing repository is not configured");
    }
    return this.listingRepository;
  }

  private getPurchaseRepository(): DataPurchaseRepository {
    if (!this.purchaseRepository) {
      throw new Error("Data purchase repository is not configured");
    }
    return this.purchaseRepository;
  }

  private async grantBuyerAccess(assetId: string, buyerId: string): Promise<void> {
    const existingPolicy = await this.accessPolicyRepository.getByAsset(assetId);
    if (!existingPolicy) {
      await this.accessPolicyRepository.save({
        assetId,
        allowedParticipantIds: [buyerId],
        isPublic: false,
      });
      return;
    }

    if (existingPolicy.allowedParticipantIds.includes(buyerId)) {
      return;
    }

    await this.accessPolicyRepository.save({
      ...existingPolicy,
      allowedParticipantIds: [...existingPolicy.allowedParticipantIds, buyerId],
    });
  }
}
