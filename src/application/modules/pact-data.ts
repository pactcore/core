import type {
  DataAccessPolicyRepository,
  DataAssetMetadataStore,
  DataListingRepository,
  DataPurchaseRepository,
  IntegrityProofRepository,
  ProvenanceGraph,
} from "../contracts";
import {
  aggregateAdapterHealth,
  DataAdapterError,
  type AdapterHealthReport,
  type AdapterHealthSummary,
} from "../adapter-runtime";
import {
  aggregateManagedBackendHealth,
  resolveManagedBackendHealth,
  type DataManagedBackendSuite,
  type ManagedBackendHealthReport,
} from "../managed-backends";
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
    private readonly assetRepository: DataAssetMetadataStore,
    private readonly provenanceGraph: ProvenanceGraph,
    private readonly integrityProofRepository: IntegrityProofRepository,
    private readonly accessPolicyRepository: DataAccessPolicyRepository,
    private readonly listingRepository?: DataListingRepository,
    private readonly purchaseRepository?: DataPurchaseRepository,
    private readonly managedBackends: DataManagedBackendSuite = {},
  ) {}

  async publish(input: PublishDataAssetInput): Promise<DataAsset> {
    return this.withDataAdapterError("publish", async () => {
      const createdAt = Date.now();
      const asset: DataAsset = {
        id: generateId("data"),
        ownerId: input.ownerId,
        title: input.title,
        uri: input.uri,
        tags: input.tags ?? [],
        createdAt,
      };

      await this.assetRepository.save(asset);

      if (input.derivedFrom) {
        for (const parentId of input.derivedFrom) {
          await this.provenanceGraph.addEdge({
            childId: asset.id,
            parentId,
            relationship: "derived_from",
            createdAt,
          });
        }
      }

      const policy = {
        assetId: asset.id,
        allowedParticipantIds: [input.ownerId],
        isPublic: true,
      };
      await this.accessPolicyRepository.save(policy);
      await this.syncManagedPublication(asset, policy, input.derivedFrom ?? [], createdAt);

      return asset;
    });
  }

  async list(): Promise<DataAsset[]> {
    return this.withDataAdapterError("list", () => this.assetRepository.list());
  }

  async getById(id: string): Promise<DataAsset | undefined> {
    return this.withDataAdapterError("get_by_id", () => this.assetRepository.getById(id));
  }

  async getLineage(assetId: string) {
    return this.withDataAdapterError("get_lineage", () => this.provenanceGraph.getLineage(assetId));
  }

  async getDependents(assetId: string) {
    return this.withDataAdapterError("get_dependents", () => this.provenanceGraph.getDependents(assetId));
  }

  async registerIntegrityProof(assetId: string, contentHash: string): Promise<IntegrityProof> {
    return this.withDataAdapterError("register_integrity_proof", async () => {
      const proof: IntegrityProof = {
        assetId,
        algorithm: "sha-256",
        hash: contentHash,
        provenAt: Date.now(),
      };
      await this.integrityProofRepository.save(proof);
      await this.syncManagedIntegrityProof(proof);
      return proof;
    });
  }

  async verifyIntegrity(assetId: string, contentHash: string): Promise<boolean> {
    return this.withDataAdapterError("verify_integrity", async () => {
      const proof = await this.integrityProofRepository.getByAsset(assetId);
      if (!proof) return false;
      return proof.hash === contentHash;
    });
  }

  async setAccessPolicy(
    assetId: string,
    allowedParticipantIds: string[],
    isPublic: boolean,
  ): Promise<DataAccessPolicy> {
    return this.withDataAdapterError("set_access_policy", async () => {
      const recordedAt = Date.now();
      const policy: DataAccessPolicy = { assetId, allowedParticipantIds, isPublic };
      await this.accessPolicyRepository.save(policy);
      await this.syncManagedAccessPolicy(policy, recordedAt, "set");
      return policy;
    });
  }

  async checkAccess(assetId: string, participantId: string): Promise<boolean> {
    return this.withDataAdapterError("check_access", async () => {
      const policy = await this.accessPolicyRepository.getByAsset(assetId);
      if (!policy) return false;
      if (policy.isPublic) return true;
      return policy.allowedParticipantIds.includes(participantId);
    });
  }

  async listAsset(assetId: string, priceCents: number, category: DataCategory): Promise<DataListing> {
    return this.withDataAdapterError("list_asset", async () => {
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
      await this.syncManagedListing(listing, listing.listedAt, "listed");
      return listing;
    });
  }

  async delistAsset(listingId: string): Promise<void> {
    await this.withDataAdapterError("delist_asset", async () => {
      const listingRepository = this.getListingRepository();
      const listing = await listingRepository.getById(listingId);
      if (!listing) {
        throw new Error(`Listing ${listingId} not found`);
      }

      const updatedListing = {
        ...listing,
        active: false,
      };
      await listingRepository.save(updatedListing);
      await this.syncManagedListing(updatedListing, Date.now(), "delisted");
    });
  }

  async purchaseAsset(listingId: string, buyerId: string): Promise<DataPurchase> {
    return this.withDataAdapterError("purchase_asset", async () => {
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
      const policy = await this.grantBuyerAccess(listing.assetId, buyerId);
      await this.syncManagedPurchase(purchase, listing, policy);
      return purchase;
    });
  }

  async getMarketplaceStats(): Promise<DataMarketplaceStats> {
    return this.withDataAdapterError("get_marketplace_stats", async () => {
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
    });
  }

  async listMarketplace(category?: DataCategory): Promise<DataListing[]> {
    return this.withDataAdapterError("list_marketplace", async () => {
      const listingRepository = this.getListingRepository();
      if (category) {
        const listings = await listingRepository.listByCategory(category);
        return listings.filter((listing) => listing.active);
      }
      return listingRepository.listActive();
    });
  }

  async getAdapterHealth(): Promise<AdapterHealthSummary> {
    const reports: AdapterHealthReport[] = [
      this.assetRepository.getHealth
        ? await this.assetRepository.getHealth()
        : {
            name: "asset-metadata-store",
            state: this.assetRepository.isDurable?.() ? "healthy" : "degraded",
            checkedAt: Date.now(),
            durable: this.assetRepository.isDurable?.() ?? false,
            durability: this.assetRepository.durability ?? "memory",
            features: {
              assetMetadata: true,
            },
          },
      {
        name: "provenance-graph",
        state: "healthy",
        checkedAt: Date.now(),
        durable: false,
        durability: "memory",
        features: {
          lineageTracking: true,
        },
      },
      {
        name: "integrity-proof-repository",
        state: "healthy",
        checkedAt: Date.now(),
        durable: false,
        durability: "memory",
        features: {
          integrityVerification: true,
        },
      },
      {
        name: "access-policy-repository",
        state: "healthy",
        checkedAt: Date.now(),
        durable: false,
        durability: "memory",
        features: {
          accessControl: true,
          marketplace: Boolean(this.listingRepository && this.purchaseRepository),
        },
      },
    ];

    return aggregateAdapterHealth(reports);
  }

  async getManagedBackendHealth() {
    const assetRepositoryHealth = this.assetRepository.getHealth
      ? await this.assetRepository.getHealth()
      : {
          name: "asset-metadata-store",
          state: this.assetRepository.isDurable?.() ? "healthy" : "degraded",
          checkedAt: Date.now(),
          durable: this.assetRepository.isDurable?.() ?? false,
          durability: this.assetRepository.durability ?? "memory",
          features: {
            assetMetadata: true,
          },
        };
    const backends: ManagedBackendHealthReport[] = [
      await resolveManagedBackendHealth(this.managedBackends.queue, {
        name: "data-queue-backend",
        domain: "data",
        capability: "queue",
        mode: "local",
        state: "healthy",
        checkedAt: Date.now(),
        durable: false,
        durability: "memory",
        features: {
          synchronousDispatch: true,
          inlinePublication: true,
        },
      }),
      await resolveManagedBackendHealth(this.managedBackends.store, {
        ...assetRepositoryHealth,
        name: "data-store-backend",
        domain: "data",
        capability: "store",
        mode: "local",
        features: {
          ...(assetRepositoryHealth.features ?? {}),
          listings: Boolean(this.listingRepository),
          purchases: Boolean(this.purchaseRepository),
        },
      }),
      await resolveManagedBackendHealth(this.managedBackends.observability, {
        name: "data-observability-backend",
        domain: "data",
        capability: "observability",
        mode: "local",
        state: "healthy",
        checkedAt: Date.now(),
        durable: false,
        durability: "memory",
        features: {
          lineageTracking: true,
          integrityVerification: true,
          marketplace: Boolean(this.listingRepository && this.purchaseRepository),
        },
      }),
    ];

    return aggregateManagedBackendHealth(backends);
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

  private async grantBuyerAccess(assetId: string, buyerId: string): Promise<DataAccessPolicy> {
    const existingPolicy = await this.accessPolicyRepository.getByAsset(assetId);
    if (!existingPolicy) {
      const policy = {
        assetId,
        allowedParticipantIds: [buyerId],
        isPublic: false,
      };
      await this.accessPolicyRepository.save(policy);
      return policy;
    }

    if (existingPolicy.allowedParticipantIds.includes(buyerId)) {
      return existingPolicy;
    }

    const updatedPolicy = {
      ...existingPolicy,
      allowedParticipantIds: [...existingPolicy.allowedParticipantIds, buyerId],
    };
    await this.accessPolicyRepository.save(updatedPolicy);
    return updatedPolicy;
  }

  private async syncManagedPublication(
    asset: DataAsset,
    policy: DataAccessPolicy,
    derivedFrom: string[],
    createdAt: number,
  ): Promise<void> {
    await this.managedBackends.queue?.enqueue({
      id: `data-publish:${asset.id}`,
      topic: "data.asset.publish",
      payload: {
        assetId: asset.id,
        ownerId: asset.ownerId,
        uri: asset.uri,
        derivedFrom,
      },
      createdAt,
      metadata: {
        assetId: asset.id,
        ownerId: asset.ownerId,
      },
    });

    await this.storeManagedAssetSnapshot(asset, policy, derivedFrom, createdAt);

    await this.managedBackends.observability?.recordMetric({
      name: "data.assets.published",
      type: "counter",
      value: 1,
      recordedAt: createdAt,
      labels: {
        ownerId: asset.ownerId,
      },
    });

    await this.managedBackends.observability?.recordTrace({
      traceId: `data-asset:${asset.id}`,
      spanId: "publish",
      name: "data.asset.publish",
      startedAt: createdAt,
      endedAt: Date.now(),
      status: "ok",
      attributes: {
        assetId: asset.id,
        ownerId: asset.ownerId,
        derivedFromCount: derivedFrom.length,
      },
    });
  }

  private async syncManagedAccessPolicy(
    policy: DataAccessPolicy,
    recordedAt: number,
    source: "set" | "purchase_grant",
  ): Promise<void> {
    await this.managedBackends.queue?.enqueue({
      id: `data-policy:${policy.assetId}:${source}:${recordedAt}`,
      topic: "data.policy.update",
      payload: {
        assetId: policy.assetId,
        allowedParticipantIds: [...policy.allowedParticipantIds],
        isPublic: policy.isPublic,
        source,
      },
      createdAt: recordedAt,
      metadata: {
        assetId: policy.assetId,
        source,
      },
    });

    await this.managedBackends.store?.put({
      key: `policy:${policy.assetId}`,
      value: policy,
      updatedAt: recordedAt,
      metadata: {
        assetId: policy.assetId,
        isPublic: String(policy.isPublic),
        recordType: "access_policy",
      },
    });

    await this.refreshManagedAssetSnapshot(policy.assetId, policy, recordedAt);

    await this.managedBackends.observability?.recordMetric({
      name: "data.access_policy.updates",
      type: "counter",
      value: 1,
      recordedAt,
      labels: {
        isPublic: String(policy.isPublic),
        source,
      },
    });

    await this.managedBackends.observability?.recordTrace({
      traceId: `data-policy:${policy.assetId}`,
      spanId: source,
      name: "data.policy.update",
      startedAt: recordedAt,
      endedAt: Date.now(),
      status: "ok",
      attributes: {
        assetId: policy.assetId,
        source,
        allowedParticipants: policy.allowedParticipantIds.length,
        isPublic: policy.isPublic,
      },
    });
  }

  private async syncManagedListing(
    listing: DataListing,
    recordedAt: number,
    action: "listed" | "delisted",
  ): Promise<void> {
    await this.managedBackends.queue?.enqueue({
      id: `data-listing:${listing.id}:${action}:${recordedAt}`,
      topic: "data.marketplace.listing",
      payload: {
        action,
        listingId: listing.id,
        assetId: listing.assetId,
        sellerId: listing.sellerId,
        priceCents: listing.priceCents,
        category: listing.category,
        active: listing.active,
      },
      createdAt: recordedAt,
      metadata: {
        listingId: listing.id,
        action,
      },
    });

    await this.managedBackends.store?.put({
      key: `listing:${listing.id}`,
      value: listing,
      updatedAt: recordedAt,
      metadata: {
        assetId: listing.assetId,
        sellerId: listing.sellerId,
        recordType: "marketplace_listing",
      },
    });

    await this.managedBackends.observability?.recordMetric({
      name: "data.marketplace.listings",
      type: "counter",
      value: 1,
      recordedAt,
      labels: {
        action,
        category: listing.category,
        active: String(listing.active),
      },
    });

    await this.managedBackends.observability?.recordTrace({
      traceId: `data-listing:${listing.id}`,
      spanId: action,
      name: "data.marketplace.listing",
      startedAt: recordedAt,
      endedAt: Date.now(),
      status: "ok",
      attributes: {
        listingId: listing.id,
        assetId: listing.assetId,
        sellerId: listing.sellerId,
        category: listing.category,
        active: listing.active,
      },
    });
  }

  private async syncManagedPurchase(
    purchase: DataPurchase,
    listing: DataListing,
    policy: DataAccessPolicy,
  ): Promise<void> {
    await this.managedBackends.queue?.enqueue({
      id: `data-purchase:${purchase.id}`,
      topic: "data.marketplace.purchase",
      payload: {
        purchaseId: purchase.id,
        listingId: purchase.listingId,
        assetId: purchase.assetId,
        buyerId: purchase.buyerId,
        sellerId: listing.sellerId,
        priceCents: purchase.priceCents,
      },
      createdAt: purchase.purchasedAt,
      metadata: {
        purchaseId: purchase.id,
        assetId: purchase.assetId,
      },
    });

    await this.managedBackends.store?.put({
      key: `purchase:${purchase.id}`,
      value: purchase,
      updatedAt: purchase.purchasedAt,
      metadata: {
        assetId: purchase.assetId,
        buyerId: purchase.buyerId,
        recordType: "marketplace_purchase",
      },
    });

    await this.syncManagedAccessPolicy(policy, purchase.purchasedAt, "purchase_grant");

    await this.managedBackends.observability?.recordMetric({
      name: "data.marketplace.purchases",
      type: "counter",
      value: 1,
      recordedAt: purchase.purchasedAt,
      labels: {
        assetId: purchase.assetId,
        buyerId: purchase.buyerId,
      },
    });

    await this.managedBackends.observability?.recordTrace({
      traceId: `data-purchase:${purchase.id}`,
      spanId: "purchase",
      name: "data.marketplace.purchase",
      startedAt: purchase.purchasedAt,
      endedAt: Date.now(),
      status: "ok",
      attributes: {
        purchaseId: purchase.id,
        listingId: purchase.listingId,
        assetId: purchase.assetId,
        buyerId: purchase.buyerId,
        priceCents: purchase.priceCents,
      },
    });
  }

  private async syncManagedIntegrityProof(proof: IntegrityProof): Promise<void> {
    await this.managedBackends.store?.put({
      key: `integrity:${proof.assetId}`,
      value: proof,
      updatedAt: proof.provenAt,
      metadata: {
        assetId: proof.assetId,
        algorithm: proof.algorithm,
        recordType: "integrity_proof",
      },
    });

    await this.managedBackends.observability?.recordMetric({
      name: "data.integrity.proofs.registered",
      type: "counter",
      value: 1,
      recordedAt: proof.provenAt,
      labels: {
        algorithm: proof.algorithm,
      },
    });

    await this.managedBackends.observability?.recordTrace({
      traceId: `data-integrity:${proof.assetId}`,
      spanId: "register",
      name: "data.integrity.register",
      startedAt: proof.provenAt,
      endedAt: Date.now(),
      status: "ok",
      attributes: {
        assetId: proof.assetId,
        algorithm: proof.algorithm,
      },
    });
  }

  private async refreshManagedAssetSnapshot(
    assetId: string,
    policy: DataAccessPolicy,
    updatedAt: number,
  ): Promise<void> {
    const asset = await this.assetRepository.getById(assetId);
    if (!asset) {
      return;
    }

    const derivedFrom = (await this.provenanceGraph.getLineage(assetId))
      .filter((edge) => edge.childId === assetId)
      .map((edge) => edge.parentId);
    await this.storeManagedAssetSnapshot(asset, policy, derivedFrom, updatedAt);
  }

  private async storeManagedAssetSnapshot(
    asset: DataAsset,
    policy: DataAccessPolicy,
    derivedFrom: string[],
    updatedAt: number,
  ): Promise<void> {
    await this.managedBackends.store?.put({
      key: `asset:${asset.id}`,
      value: {
        asset,
        accessPolicy: policy,
        derivedFrom,
      },
      updatedAt,
      metadata: {
        ownerId: asset.ownerId,
        recordType: "asset_publication",
      },
    });
  }

  private async withDataAdapterError<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof DataAdapterError) {
        throw error;
      }

      throw new DataAdapterError(error instanceof Error ? error.message : String(error), {
        operation,
        code: this.resolveDataErrorCode(operation, error),
        retryable: this.isRetryableError(error),
        cause: error,
      });
    }
  }

  private resolveDataErrorCode(operation: string, error: unknown): string {
    const code = (error as { code?: string }).code;
    if (typeof code === "string") {
      return `data_${code.toLowerCase()}`;
    }

    return `data_${operation}_failed`;
  }

  private isRetryableError(error: unknown): boolean {
    const code = (error as { code?: string }).code;
    return code === "EAGAIN" || code === "ETIMEDOUT" || code === "ECONNRESET";
  }
}
