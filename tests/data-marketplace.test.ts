import { describe, expect, test } from "bun:test";
import { PactData } from "../src/application/modules/pact-data";
import { calculateRevenueDistribution } from "../src/domain/data-marketplace";
import { InMemoryDataAccessPolicyRepository } from "../src/infrastructure/data/in-memory-data-access-policy-repository";
import { InMemoryDataAssetRepository } from "../src/infrastructure/data/in-memory-data-asset-repository";
import { InMemoryDataListingRepository } from "../src/infrastructure/data/in-memory-data-listing-repository";
import { InMemoryDataPurchaseRepository } from "../src/infrastructure/data/in-memory-data-purchase-repository";
import { InMemoryIntegrityProofRepository } from "../src/infrastructure/data/in-memory-integrity-proof-repository";
import { InMemoryProvenanceGraph } from "../src/infrastructure/data/in-memory-provenance-graph";

function setup() {
  const listingRepository = new InMemoryDataListingRepository();
  const purchaseRepository = new InMemoryDataPurchaseRepository();
  const data = new PactData(
    new InMemoryDataAssetRepository(),
    new InMemoryProvenanceGraph(),
    new InMemoryIntegrityProofRepository(),
    new InMemoryDataAccessPolicyRepository(),
    listingRepository,
    purchaseRepository,
  );

  return { data, listingRepository, purchaseRepository };
}

describe("Data marketplace", () => {
  test("revenue distribution 70/10/20 split is correct", () => {
    const distribution = calculateRevenueDistribution(1_000);
    expect(distribution.producerCents).toBe(700);
    expect(distribution.validatorCents).toBe(100);
    expect(distribution.protocolCents).toBe(200);
  });

  test("revenue distribution rounds correctly for odd amounts", () => {
    const distribution = calculateRevenueDistribution(101);
    expect(distribution.producerCents).toBe(70);
    expect(distribution.validatorCents).toBe(10);
    expect(distribution.protocolCents).toBe(21);
    expect(distribution.producerCents + distribution.validatorCents + distribution.protocolCents).toBe(
      101,
    );
  });

  test("list asset creates active listing", async () => {
    const { data } = setup();
    const asset = await data.publish({ ownerId: "seller-1", title: "Road telemetry", uri: "s3://a" });

    const listing = await data.listAsset(asset.id, 2_500, "sensor");

    expect(listing.id).toMatch(/^listing_/);
    expect(listing.assetId).toBe(asset.id);
    expect(listing.sellerId).toBe("seller-1");
    expect(listing.priceCents).toBe(2_500);
    expect(listing.currency).toBe("USDC");
    expect(listing.active).toBe(true);
  });

  test("delist asset deactivates listing", async () => {
    const { data, listingRepository } = setup();
    const asset = await data.publish({ ownerId: "seller-1", title: "Aerial imagery", uri: "s3://b" });
    const listing = await data.listAsset(asset.id, 4_000, "image_video");

    await data.delistAsset(listing.id);

    const storedListing = await listingRepository.getById(listing.id);
    expect(storedListing?.active).toBe(false);
  });

  test("purchase asset creates purchase record with correct distribution", async () => {
    const { data, purchaseRepository } = setup();
    const asset = await data.publish({ ownerId: "seller-1", title: "Traffic labels", uri: "s3://c" });
    const listing = await data.listAsset(asset.id, 101, "labeled");

    const purchase = await data.purchaseAsset(listing.id, "buyer-1");

    expect(purchase.id).toMatch(/^purchase_/);
    expect(purchase.listingId).toBe(listing.id);
    expect(purchase.assetId).toBe(asset.id);
    expect(purchase.buyerId).toBe("buyer-1");
    expect(purchase.priceCents).toBe(101);
    expect(purchase.revenueDistribution).toEqual({
      producerCents: 70,
      validatorCents: 10,
      protocolCents: 21,
    });
    expect(await purchaseRepository.getById(purchase.id)).toEqual(purchase);
  });

  test("purchase auto-grants access to buyer", async () => {
    const { data } = setup();
    const asset = await data.publish({ ownerId: "seller-1", title: "Survey batch", uri: "s3://d" });
    await data.setAccessPolicy(asset.id, ["seller-1"], false);
    const listing = await data.listAsset(asset.id, 900, "survey");

    expect(await data.checkAccess(asset.id, "buyer-2")).toBe(false);

    await data.purchaseAsset(listing.id, "buyer-2");

    expect(await data.checkAccess(asset.id, "buyer-2")).toBe(true);
  });

  test("marketplace stats are accurate", async () => {
    const { data } = setup();
    const asset1 = await data.publish({ ownerId: "seller-1", title: "Geo traces", uri: "s3://e" });
    const asset2 = await data.publish({ ownerId: "seller-2", title: "Sensor pack", uri: "s3://f" });

    const listing1 = await data.listAsset(asset1.id, 1_000, "geolocation");
    const listing2 = await data.listAsset(asset2.id, 2_500, "sensor");

    await data.purchaseAsset(listing1.id, "buyer-a");
    await data.purchaseAsset(listing1.id, "buyer-b");
    await data.purchaseAsset(listing2.id, "buyer-c");

    const stats = await data.getMarketplaceStats();
    expect(stats).toEqual({
      totalListings: 2,
      totalPurchases: 3,
      totalRevenueCents: 4_500,
    });
  });

  test("filter listings by category", async () => {
    const { data } = setup();
    const geoAsset = await data.publish({ ownerId: "seller-1", title: "Geo", uri: "s3://geo" });
    const sensorAsset1 = await data.publish({ ownerId: "seller-2", title: "Sensor 1", uri: "s3://s1" });
    const sensorAsset2 = await data.publish({ ownerId: "seller-3", title: "Sensor 2", uri: "s3://s2" });

    await data.listAsset(geoAsset.id, 300, "geolocation");
    await data.listAsset(sensorAsset1.id, 400, "sensor");
    const inactiveSensorListing = await data.listAsset(sensorAsset2.id, 500, "sensor");
    await data.delistAsset(inactiveSensorListing.id);

    const sensorListings = await data.listMarketplace("sensor");

    expect(sensorListings).toHaveLength(1);
    expect(sensorListings[0]?.category).toBe("sensor");
    expect(sensorListings[0]?.active).toBe(true);
  });
});
