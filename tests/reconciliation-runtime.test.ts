import { describe, expect, it } from "bun:test";
import { createApp } from "../src/api/app";
import { PactEconomics } from "../src/application/modules/pact-economics";
import { PactReconciliation } from "../src/application/modules/pact-reconciliation";
import { InMemoryDurableSettlementRecordRepository } from "../src/infrastructure/repositories/in-memory-durable-settlement-record-repository";
import { InMemoryApiQuotaAllocationConnector } from "../src/infrastructure/settlement/in-memory-api-quota-allocation-connector";
import { InMemoryCloudCreditBillingConnector } from "../src/infrastructure/settlement/in-memory-cloud-credit-billing-connector";
import { InMemoryLlmTokenMeteringConnector } from "../src/infrastructure/settlement/in-memory-llm-token-metering-connector";

describe("Reconciliation runtime", () => {
  it("reports healthy connector states with retry policy", async () => {
    const { reconciliation } = await createHarness();

    const health = reconciliation.getConnectorHealth();

    expect(health).toHaveLength(3);
    expect(health.every((entry) => entry.state === "healthy")).toBeTrue();
    expect(health.every((entry) => entry.retryPolicy.maxRetries === 2)).toBeTrue();
  });

  it("captures lastFailure and recovers health after retry success", async () => {
    const { connectors, economics } = await createHarness();
    connectors.llm.queueFailure("transient llm outage", 1);

    const execution = await executeManagedSettlement(economics, "retry-success", "idem-retry-success");

    expect(execution.records).toHaveLength(3);
    const llmHealth = economics
      .getConnectorHealth()
      .find((entry) => entry.connector === "llm_token_metering");
    expect(llmHealth?.state).toBe("healthy");
    expect(llmHealth?.lastFailure?.message).toBe("transient llm outage");
    expect(llmHealth?.lastFailure?.attempt).toBe(1);
  });

  it("marks a connector unhealthy when retries are exhausted", async () => {
    const connector = new InMemoryLlmTokenMeteringConnector({
      retryPolicy: {
        maxRetries: 1,
        backoffMs: 0,
      },
    });
    connector.queueFailure("connector hard down", 2);

    await expect(
      connector.applyMeteringCredit({
        settlementId: "settlement-unhealthy",
        recordId: "record-unhealthy",
        legId: "leg-unhealthy",
        assetId: "llm-gpt5",
        payerId: "issuer-1",
        payeeId: "agent-1",
        amount: 100,
        unit: "token",
        idempotencyKey: "connector-unhealthy",
      }),
    ).rejects.toThrow("connector hard down");

    const health = connector.getHealth();
    expect(health.state).toBe("unhealthy");
    expect(health.lastFailure?.attempt).toBe(2);
  });

  it("deduplicates settlement execution by idempotency key", async () => {
    const { economics } = await createHarness();

    const first = await executeManagedSettlement(economics, "dedupe-settlement", "idem-dedupe");
    const second = await executeManagedSettlement(economics, "dedupe-settlement", "idem-dedupe");
    const records = await economics.listSettlementRecords({ settlementId: "dedupe-settlement" });

    expect(second.records.map((record) => record.id)).toEqual(first.records.map((record) => record.id));
    expect(records).toHaveLength(3);
  });

  it("rejects idempotency key reuse with a different payload", async () => {
    const { economics } = await createHarness();

    await executeManagedSettlement(economics, "settlement-a", "idem-conflict");

    await expect(
      economics.executeSettlement({
        settlementId: "settlement-b",
        idempotencyKey: "idem-conflict",
        model: buildModel({
          llmAmount: 222_000,
        }),
      }),
    ).rejects.toThrow("idempotency key reuse with different settlement payload");
  });

  it("lists unreconciled settlements grouped by settlement id", async () => {
    const { economics, reconciliation } = await createHarness();

    await executeManagedSettlement(economics, "settlement-group-a", "idem-group-a");
    await executeManagedSettlement(economics, "settlement-group-b", "idem-group-b");

    const unreconciled = await reconciliation.listUnreconciledSettlements();

    expect(unreconciled).toHaveLength(2);
    expect(unreconciled[0]?.pendingRecordCount).toBe(3);
    expect(unreconciled[1]?.pendingRecordCount).toBe(3);
  });

  it("reconciles matched records during a reconciliation cycle", async () => {
    const { economics, reconciliation } = await createHarness();

    await executeManagedSettlement(economics, "settlement-cycle", "idem-cycle");

    const result = await reconciliation.runReconciliationCycle();
    const remaining = await reconciliation.listUnreconciledSettlements();
    const reconciled = await economics.listSettlementRecords({
      settlementId: "settlement-cycle",
      status: "reconciled",
    });

    expect(result.scannedRecordCount).toBe(3);
    expect(result.reconciledRecordCount).toBe(3);
    expect(result.pendingRecordCount).toBe(0);
    expect(remaining).toHaveLength(0);
    expect(reconciled).toHaveLength(3);
  });

  it("exposes connector health over the API", async () => {
    const app = createApp();

    const response = await app.request("/economics/connectors/health");
    const health = (await response.json()) as Array<{ connector: string; state: string }>;

    expect(response.status).toBe(200);
    expect(health).toHaveLength(3);
    expect(health.every((entry) => entry.state === "healthy")).toBeTrue();
  });

  it("runs reconciliation and lists unreconciled settlements over the API", async () => {
    const app = createApp();
    await registerAssets(app);

    const executeResponse = await app.request("/economics/settlements/execute", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "api-reconcile-key",
      },
      body: JSON.stringify({
        settlementId: "settlement-api-reconcile",
        model: buildModel(),
      }),
    });
    expect(executeResponse.status).toBe(201);

    const unreconciledResponse = await app.request("/economics/reconciliation/unreconciled");
    const unreconciled = (await unreconciledResponse.json()) as Array<{ settlementId: string }>;
    expect(unreconciledResponse.status).toBe(200);
    expect(unreconciled).toHaveLength(1);
    expect(unreconciled[0]?.settlementId).toBe("settlement-api-reconcile");

    const runResponse = await app.request("/economics/reconciliation/run", {
      method: "POST",
    });
    const result = (await runResponse.json()) as {
      reconciledRecordCount: number;
      pendingRecordCount: number;
    };
    expect(runResponse.status).toBe(201);
    expect(result.reconciledRecordCount).toBe(3);
    expect(result.pendingRecordCount).toBe(0);
  });
});

async function createHarness() {
  const connectors = {
    llm: new InMemoryLlmTokenMeteringConnector({ retryPolicy: { maxRetries: 2, backoffMs: 0 } }),
    cloud: new InMemoryCloudCreditBillingConnector({ retryPolicy: { maxRetries: 2, backoffMs: 0 } }),
    api: new InMemoryApiQuotaAllocationConnector({ retryPolicy: { maxRetries: 2, backoffMs: 0 } }),
  };
  const economics = new PactEconomics({
    settlementRecordRepository: new InMemoryDurableSettlementRecordRepository(),
    settlementConnectors: {
      llmTokenMetering: connectors.llm,
      cloudCreditBilling: connectors.cloud,
      apiQuotaAllocation: connectors.api,
    },
  });

  await registerAssetsForEconomics(economics);

  return {
    connectors,
    economics,
    reconciliation: new PactReconciliation({ pactEconomics: economics }),
  };
}

async function executeManagedSettlement(
  economics: PactEconomics,
  settlementId: string,
  idempotencyKey: string,
) {
  return economics.executeSettlement({
    settlementId,
    idempotencyKey,
    model: buildModel(),
  });
}

function buildModel(overrides: { llmAmount?: number } = {}) {
  return {
    mode: "multi_asset" as const,
    legs: [
      {
        id: "leg-1",
        payerId: "issuer-1",
        payeeId: "agent-1",
        assetId: "usdc-mainnet",
        amount: 25,
        unit: "USDC",
      },
      {
        id: "leg-2",
        payerId: "issuer-1",
        payeeId: "agent-1",
        assetId: "llm-gpt5",
        amount: overrides.llmAmount ?? 120_000,
        unit: "token",
      },
      {
        id: "leg-3",
        payerId: "issuer-1",
        payeeId: "agent-1",
        assetId: "cloud-aws",
        amount: 4,
        unit: "credit",
      },
      {
        id: "leg-4",
        payerId: "issuer-1",
        payeeId: "agent-1",
        assetId: "search-api",
        amount: 8_000,
        unit: "request",
      },
    ],
  };
}

async function registerAssetsForEconomics(economics: PactEconomics): Promise<void> {
  await economics.registerAsset({ id: "usdc-mainnet", kind: "usdc", symbol: "USDC" });
  await economics.registerAsset({ id: "llm-gpt5", kind: "llm_token", symbol: "TOKEN" });
  await economics.registerAsset({ id: "cloud-aws", kind: "cloud_credit", symbol: "AWSC" });
  await economics.registerAsset({ id: "search-api", kind: "api_quota", symbol: "QPS" });
}

async function registerAssets(app: ReturnType<typeof createApp>): Promise<void> {
  const assets = [
    { id: "usdc-mainnet", kind: "usdc", symbol: "USDC" },
    { id: "llm-gpt5", kind: "llm_token", symbol: "TOKEN" },
    { id: "cloud-aws", kind: "cloud_credit", symbol: "AWSC" },
    { id: "search-api", kind: "api_quota", symbol: "QPS" },
  ];

  for (const asset of assets) {
    const response = await app.request("/economics/assets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(asset),
    });
    expect(response.status).toBe(201);
  }
}
