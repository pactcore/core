import { describe, expect, it } from "bun:test";
import { PactEconomics } from "../src/application/modules/pact-economics";

describe("PactEconomics", () => {
  it("quotes multi-asset model in a reference asset", async () => {
    const economics = new PactEconomics();

    await economics.registerAsset({ id: "usdc-mainnet", kind: "usdc", symbol: "USDC" });
    await economics.registerAsset({ id: "llm-gpt5", kind: "llm_token", symbol: "TOKEN" });

    await economics.registerValuation({
      assetId: "llm-gpt5",
      referenceAssetId: "usdc-mainnet",
      rate: 0.0001,
      source: "internal-pricing-v1",
    });

    const quote = await economics.quoteInReference(
      {
        mode: "multi_asset",
        legs: [
          {
            id: "leg-1",
            payerId: "issuer-1",
            payeeId: "worker-1",
            assetId: "usdc-mainnet",
            amount: 25,
            unit: "USDC",
          },
          {
            id: "leg-2",
            payerId: "issuer-1",
            payeeId: "worker-1",
            assetId: "llm-gpt5",
            amount: 100000,
            unit: "token",
          },
        ],
      },
      "usdc-mainnet",
    );

    expect(quote.referenceAssetId).toBe("usdc-mainnet");
    expect(quote.totalInReference).toBe(35);
    expect(quote.missingAssetIds.length).toBe(0);
  });

  it("creates settlement plan with per-asset rails", async () => {
    const economics = new PactEconomics();

    await economics.registerAsset({ id: "usdc-mainnet", kind: "usdc", symbol: "USDC" });
    await economics.registerAsset({ id: "cloud-aws", kind: "cloud_credit", symbol: "AWSC" });
    await economics.registerAsset({ id: "search-api", kind: "api_quota", symbol: "QPS" });

    const plan = await economics.planSettlement({
      mode: "multi_asset",
      legs: [
        {
          id: "leg-1",
          payerId: "issuer-1",
          payeeId: "worker-1",
          assetId: "usdc-mainnet",
          amount: 10,
          unit: "USDC",
        },
        {
          id: "leg-2",
          payerId: "issuer-1",
          payeeId: "worker-1",
          assetId: "cloud-aws",
          amount: 8,
          unit: "credit",
        },
        {
          id: "leg-3",
          payerId: "issuer-1",
          payeeId: "worker-1",
          assetId: "search-api",
          amount: 2000,
          unit: "request",
        },
      ],
    });

    expect(plan.lines.find((line) => line.assetId === "usdc-mainnet")?.rail).toBe(
      "onchain_stablecoin",
    );
    expect(plan.lines.find((line) => line.assetId === "cloud-aws")?.rail).toBe("cloud_billing");
    expect(plan.lines.find((line) => line.assetId === "search-api")?.rail).toBe("api_quota");
  });
});
