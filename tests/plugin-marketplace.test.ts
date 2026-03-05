import { describe, expect, test } from "bun:test";
import { createApp } from "../src/api/app";
import { PactPluginMarketplace } from "../src/application/modules/pact-plugin-marketplace";
import { calculateRevenueShare } from "../src/domain/plugin-marketplace";
import { InMemoryPluginInstallRepository } from "../src/infrastructure/dev/in-memory-plugin-install-repository";
import { InMemoryPluginListingRepository } from "../src/infrastructure/dev/in-memory-plugin-listing-repository";
import { InMemoryPluginPackageRepository } from "../src/infrastructure/dev/in-memory-plugin-package-repository";
import { InMemoryPluginRevenueShareRepository } from "../src/infrastructure/dev/in-memory-plugin-revenue-share-repository";

function setupMarketplace() {
  return new PactPluginMarketplace(
    new InMemoryPluginPackageRepository(),
    new InMemoryPluginListingRepository(),
    new InMemoryPluginInstallRepository(),
    new InMemoryPluginRevenueShareRepository(),
  );
}

describe("Plugin marketplace", () => {
  test("revenue share follows 80/20 split", () => {
    const split = calculateRevenueShare(1_000);
    expect(split.developerPayoutCents).toBe(800);
    expect(split.protocolPayoutCents).toBe(200);
  });

  test("revenue share keeps cents balanced for non-even values", () => {
    const split = calculateRevenueShare(101);
    expect(split.developerPayoutCents).toBe(80);
    expect(split.protocolPayoutCents).toBe(21);
    expect(split.developerPayoutCents + split.protocolPayoutCents).toBe(101);
  });

  test("publishPlugin creates package + listing", async () => {
    const marketplace = setupMarketplace();

    const published = await marketplace.publishPlugin({
      developerId: "dev-1",
      name: "Vision OCR",
      version: "1.0.0",
      description: "OCR plugin",
      repositoryUrl: "https://github.com/pact/vision-ocr",
      priceCents: 499,
    });

    expect(published.package.id).toMatch(/^pluginpkg_/);
    expect(published.listing.id).toMatch(/^plugin_/);
    expect(published.listing.packageId).toBe(published.package.id);
    expect(published.listing.developerId).toBe("dev-1");
    expect(published.listing.active).toBe(true);
  });

  test("listPlugins returns active listings", async () => {
    const marketplace = setupMarketplace();
    await marketplace.publishPlugin({
      developerId: "dev-1",
      name: "Route optimizer",
      version: "1.1.0",
      description: "Routing plugin",
      repositoryUrl: "https://github.com/pact/route-opt",
      priceCents: 999,
    });

    const listings = await marketplace.listPlugins();
    expect(listings).toHaveLength(1);
    expect(listings[0]?.package.name).toBe("Route optimizer");
  });

  test("installPlugin records install event", async () => {
    const marketplace = setupMarketplace();
    const published = await marketplace.publishPlugin({
      developerId: "dev-1",
      name: "Geo plugin",
      version: "2.0.0",
      description: "Geo plugin",
      repositoryUrl: "https://github.com/pact/geo",
      priceCents: 250,
    });

    const install = await marketplace.installPlugin(published.listing.id, "agent-1");

    expect(install.id).toMatch(/^plugin_install_/);
    expect(install.pluginId).toBe(published.listing.id);
    expect(install.packageId).toBe(published.package.id);
    expect(install.installerId).toBe("agent-1");
  });

  test("installPlugin throws for unknown plugin", async () => {
    const marketplace = setupMarketplace();
    await expect(marketplace.installPlugin("missing-plugin", "agent-1")).rejects.toThrow(
      "Plugin missing-plugin not found",
    );
  });

  test("recordPluginRevenue persists payout using 80/20 split", async () => {
    const marketplace = setupMarketplace();
    const published = await marketplace.publishPlugin({
      developerId: "dev-1",
      name: "Analyzer",
      version: "1.0.1",
      description: "Analyzer plugin",
      repositoryUrl: "https://github.com/pact/analyzer",
      priceCents: 100,
    });

    const revenue = await marketplace.recordPluginRevenue(published.listing.id, 333);

    expect(revenue.developerId).toBe("dev-1");
    expect(revenue.grossRevenueCents).toBe(333);
    expect(revenue.developerPayoutCents).toBe(266);
    expect(revenue.protocolPayoutCents).toBe(67);
  });

  test("getDeveloperPayouts filters payouts by developer", async () => {
    const marketplace = setupMarketplace();
    const first = await marketplace.publishPlugin({
      developerId: "dev-1",
      name: "Plugin A",
      version: "1.0.0",
      description: "A",
      repositoryUrl: "https://github.com/pact/a",
      priceCents: 100,
    });
    const second = await marketplace.publishPlugin({
      developerId: "dev-2",
      name: "Plugin B",
      version: "1.0.0",
      description: "B",
      repositoryUrl: "https://github.com/pact/b",
      priceCents: 100,
    });

    await marketplace.recordPluginRevenue(first.listing.id, 1_000);
    await marketplace.recordPluginRevenue(second.listing.id, 2_000);

    const dev1Payouts = await marketplace.getDeveloperPayouts("dev-1");
    const dev2Payouts = await marketplace.getDeveloperPayouts("dev-2");

    expect(dev1Payouts).toHaveLength(1);
    expect(dev1Payouts[0]?.grossRevenueCents).toBe(1_000);
    expect(dev2Payouts).toHaveLength(1);
    expect(dev2Payouts[0]?.grossRevenueCents).toBe(2_000);
  });

  test("API routes publish/list/install/revenue/payout", async () => {
    const app = createApp();

    const publishResp = await app.request("/dev/plugins/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        developerId: "dev-api-1",
        name: "API Plugin",
        version: "0.1.0",
        description: "Plugin published via API",
        repositoryUrl: "https://github.com/pact/api-plugin",
        priceCents: 700,
      }),
    });
    expect(publishResp.status).toBe(201);
    const published = (await publishResp.json()) as {
      listing: { id: string };
      package: { id: string };
    };

    const listResp = await app.request("/dev/plugins");
    expect(listResp.status).toBe(200);
    const listings = (await listResp.json()) as Array<{ listing: { id: string } }>;
    expect(listings.length).toBeGreaterThan(0);
    expect(listings[0]?.listing.id).toBe(published.listing.id);

    const installResp = await app.request(`/dev/plugins/${published.listing.id}/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ installerId: "agent-api-1" }),
    });
    expect(installResp.status).toBe(201);

    const revenueResp = await app.request(`/dev/plugins/${published.listing.id}/revenue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revenueCents: 1_500 }),
    });
    expect(revenueResp.status).toBe(201);

    const payoutsResp = await app.request("/dev/plugins/payouts/dev-api-1");
    expect(payoutsResp.status).toBe(200);
    const payouts = (await payoutsResp.json()) as Array<{
      developerPayoutCents: number;
      protocolPayoutCents: number;
    }>;
    expect(payouts).toHaveLength(1);
    expect(payouts[0]?.developerPayoutCents).toBe(1_200);
    expect(payouts[0]?.protocolPayoutCents).toBe(300);
  });

  test("API revenue endpoint rejects unknown plugin", async () => {
    const app = createApp();
    const response = await app.request("/dev/plugins/does-not-exist/revenue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revenueCents: 1_000 }),
    });

    expect(response.status).toBe(400);
  });
});
