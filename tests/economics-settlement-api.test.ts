import { describe, expect, it } from "bun:test";
import { createApp } from "../src/api/app";
import { createContainer } from "../src/application/container";
import { PactEconomics } from "../src/application/modules/pact-economics";
import { PactReconciliation } from "../src/application/modules/pact-reconciliation";
import { InMemoryDurableSettlementRecordRepository } from "../src/infrastructure/repositories/in-memory-durable-settlement-record-repository";
import { InMemoryApiQuotaAllocationConnector } from "../src/infrastructure/settlement/in-memory-api-quota-allocation-connector";
import { InMemoryCloudCreditBillingConnector } from "../src/infrastructure/settlement/in-memory-cloud-credit-billing-connector";
import { InMemoryLlmTokenMeteringConnector } from "../src/infrastructure/settlement/in-memory-llm-token-metering-connector";

describe("Economics settlement API", () => {
  it("executes non-stablecoin settlement and exposes audit records", async () => {
    const app = createApp();

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

    const executeResponse = await app.request("/economics/settlements/execute", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "economics-settlement-api-1",
      },
      body: JSON.stringify({
        settlementId: "settlement-api-1",
        model: {
          mode: "multi_asset",
          legs: [
            {
              id: "leg-1",
              payerId: "issuer-1",
              payeeId: "agent-1",
              assetId: "usdc-mainnet",
              amount: 12,
              unit: "USDC",
            },
            {
              id: "leg-2",
              payerId: "issuer-1",
              payeeId: "agent-1",
              assetId: "llm-gpt5",
              amount: 150000,
              unit: "token",
            },
            {
              id: "leg-3",
              payerId: "issuer-1",
              payeeId: "agent-1",
              assetId: "cloud-aws",
              amount: 3,
              unit: "credit",
            },
            {
              id: "leg-4",
              payerId: "issuer-1",
              payeeId: "agent-1",
              assetId: "search-api",
              amount: 2400,
              unit: "request",
            },
          ],
        },
      }),
    });

    expect(executeResponse.status).toBe(201);
    const execution = (await executeResponse.json()) as {
      settlementId: string;
      records: Array<{ id: string; rail: string }>;
    };
    expect(execution.settlementId).toBe("settlement-api-1");
    expect(execution.records.length).toBe(3);

    const listResponse = await app.request(
      "/economics/settlements/records?settlementId=settlement-api-1",
    );
    expect(listResponse.status).toBe(200);
    const records = (await listResponse.json()) as Array<{ id: string }>;
    expect(records.length).toBe(3);

    const recordId = records[0]?.id;
    expect(recordId).toBeDefined();
    if (!recordId) {
      throw new Error("expected at least one settlement record");
    }

    const getResponse = await app.request(`/economics/settlements/records/${recordId}`);
    expect(getResponse.status).toBe(200);
    const record = (await getResponse.json()) as { id: string; settlementId: string };
    expect(record.id).toBe(recordId);
    expect(record.settlementId).toBe("settlement-api-1");

    const pageResponse = await app.request(
      "/economics/settlements/records/page?settlementId=settlement-api-1&limit=2",
    );
    expect(pageResponse.status).toBe(200);
    const page = (await pageResponse.json()) as {
      items: Array<{ id: string; status: string }>;
      nextCursor?: string;
    };
    expect(page.items.length).toBe(2);
    expect(page.nextCursor).toBeDefined();

    const reconcileResponse = await app.request(`/economics/settlements/records/${recordId}/reconcile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reconciledBy: "auditor-1",
        note: "connector ledger matched",
      }),
    });
    expect(reconcileResponse.status).toBe(200);
    const reconciled = (await reconcileResponse.json()) as {
      id: string;
      status: string;
      reconciledBy?: string;
    };
    expect(reconciled.id).toBe(recordId);
    expect(reconciled.status).toBe("reconciled");
    expect(reconciled.reconciledBy).toBe("auditor-1");

    const reconciledFilterResponse = await app.request(
      "/economics/settlements/records?settlementId=settlement-api-1&status=reconciled",
    );
    expect(reconciledFilterResponse.status).toBe(200);
    const reconciledRecords = (await reconciledFilterResponse.json()) as Array<{ id: string }>;
    expect(reconciledRecords.length).toBe(1);
    expect(reconciledRecords[0]?.id).toBe(recordId);

    const replayResponse = await app.request("/economics/settlements/records/replay?fromOffset=0&limit=20");
    expect(replayResponse.status).toBe(200);
    const replay = (await replayResponse.json()) as {
      entries: Array<{ action: string; recordId: string }>;
    };
    expect(replay.entries.some((entry) => entry.action === "created")).toBeTrue();
    expect(
      replay.entries.some((entry) => entry.action === "reconciled" && entry.recordId === recordId),
    ).toBeTrue();
  });

  it("validates idempotency, paginates pending reconciliation, and resets connector breakers", async () => {
    const app = createApp();
    await registerAssets(app);

    const missingIdempotencyResponse = await app.request("/economics/settlements/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        settlementId: "settlement-no-idem",
        model: buildSettlementModel("settlement-no-idem"),
      }),
    });
    expect(missingIdempotencyResponse.status).toBe(400);

    const firstExecute = await app.request("/economics/settlements/execute", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "pending-route-key-1",
      },
      body: JSON.stringify({
        settlementId: "settlement-pending-1",
        model: buildSettlementModel("settlement-pending-1"),
      }),
    });
    expect(firstExecute.status).toBe(201);

    const secondExecute = await app.request("/economics/settlements/execute", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "pending-route-key-2",
      },
      body: JSON.stringify({
        settlementId: "settlement-pending-2",
        model: buildSettlementModel("settlement-pending-2"),
      }),
    });
    expect(secondExecute.status).toBe(201);

    const firstPendingResponse = await app.request("/economics/reconciliation/pending?limit=1");
    expect(firstPendingResponse.status).toBe(200);
    const firstPendingPage = (await firstPendingResponse.json()) as {
      items: Array<{ settlementId: string; state: string }>;
      nextCursor?: string;
    };
    expect(firstPendingPage.items).toHaveLength(1);
    expect(firstPendingPage.items[0]?.state).toBe("pending");
    expect(firstPendingPage.nextCursor).toBeDefined();

    const secondPendingResponse = await app.request(
      `/economics/reconciliation/pending?limit=1&cursor=${firstPendingPage.nextCursor}`,
    );
    expect(secondPendingResponse.status).toBe(200);
    const secondPendingPage = (await secondPendingResponse.json()) as {
      items: Array<{ settlementId: string }>;
    };
    expect(secondPendingPage.items).toHaveLength(1);
    expect(secondPendingPage.items[0]?.settlementId).not.toBe(firstPendingPage.items[0]?.settlementId);

    const invalidLowLimitResponse = await app.request("/economics/reconciliation/pending?limit=0");
    expect(invalidLowLimitResponse.status).toBe(400);

    const invalidHighLimitResponse = await app.request("/economics/reconciliation/pending?limit=201");
    expect(invalidHighLimitResponse.status).toBe(400);

    const summaryResponse = await app.request("/economics/reconciliation/summary");
    expect(summaryResponse.status).toBe(200);
    const summary = (await summaryResponse.json()) as {
      pendingSettlementCount: number;
      pendingRecordCount: number;
      failedSettlementCount: number;
    };
    expect(summary.pendingSettlementCount).toBe(2);
    expect(summary.pendingRecordCount).toBe(6);
    expect(summary.failedSettlementCount).toBe(0);

    const filteredPendingResponse = await app.request(
      "/economics/reconciliation/queue?state=pending&connector=cloud_credit_billing&settlementId=settlement-pending-1",
    );
    expect(filteredPendingResponse.status).toBe(200);
    const filteredPendingQueue = (await filteredPendingResponse.json()) as {
      items: Array<{ settlementId: string; connectors: string[] }>;
    };
    expect(filteredPendingQueue.items).toHaveLength(1);
    expect(filteredPendingQueue.items[0]?.settlementId).toBe("settlement-pending-1");
    expect(filteredPendingQueue.items[0]?.connectors).toContain("cloud_credit_billing");

    const failingLlmConnector = new InMemoryLlmTokenMeteringConnector({
      retryPolicy: { maxRetries: 0, backoffMs: 0 },
      circuitBreaker: { failureThreshold: 1, cooldownMs: 60_000 },
    });
    failingLlmConnector.queueFailure("connector breaker test", 1);
    const failingEconomics = new PactEconomics({
      settlementRecordRepository: new InMemoryDurableSettlementRecordRepository(),
      settlementConnectors: {
        llmTokenMetering: failingLlmConnector,
        cloudCreditBilling: new InMemoryCloudCreditBillingConnector(),
        apiQuotaAllocation: new InMemoryApiQuotaAllocationConnector(),
      },
    });
    await registerAssetsForEconomics(failingEconomics);

    const container = createContainer();
    container.pactEconomics = failingEconomics;
    container.pactReconciliation = new PactReconciliation({ pactEconomics: failingEconomics });
    const failingApp = createApp(undefined, { container });

    const failedExecute = await failingApp.request("/economics/settlements/execute", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "failing-route-key",
      },
      body: JSON.stringify({
        settlementId: "settlement-failed-1",
        model: buildSettlementModel("settlement-failed-1"),
      }),
    });
    expect(failedExecute.status).toBe(400);

    const failedQueueResponse = await failingApp.request(
      "/economics/reconciliation/pending?state=failed&limit=10",
    );
    expect(failedQueueResponse.status).toBe(200);
    const failedQueue = (await failedQueueResponse.json()) as {
      items: Array<{ settlementId: string; state: string; lastError?: string }>;
    };
    expect(failedQueue.items).toHaveLength(1);
    expect(failedQueue.items[0]?.state).toBe("failed");
    expect(failedQueue.items[0]?.lastError).toContain("connector breaker test");

    const failedSummaryResponse = await failingApp.request("/economics/reconciliation/summary");
    expect(failedSummaryResponse.status).toBe(200);
    const failedSummary = (await failedSummaryResponse.json()) as {
      failedSettlementCount: number;
      failedRecordCount: number;
      pendingSettlementCount: number;
    };
    expect(failedSummary.failedSettlementCount).toBe(1);
    expect(failedSummary.failedRecordCount).toBe(1);
    expect(failedSummary.pendingSettlementCount).toBe(0);

    const failedQueryResponse = await failingApp.request(
      "/economics/reconciliation/queue?state=failed&idempotencyKey=failing-route-key",
    );
    expect(failedQueryResponse.status).toBe(200);
    const failedQuery = (await failedQueryResponse.json()) as {
      items: Array<{ settlementId: string; idempotencyKey?: string }>;
    };
    expect(failedQuery.items).toHaveLength(1);
    expect(failedQuery.items[0]?.settlementId).toBe("settlement-failed-1");
    expect(failedQuery.items[0]?.idempotencyKey).toBe("failing-route-key");

    const healthResponse = await failingApp.request("/economics/connectors/health");
    expect(healthResponse.status).toBe(200);
    const health = (await healthResponse.json()) as Array<{
      connector: string;
      state: string;
      consecutiveFailures: number;
    }>;
    const llmHealth = health.find((entry) => entry.connector === "llm_token_metering");
    expect(llmHealth?.state).toBe("open");
    expect(llmHealth?.consecutiveFailures).toBe(1);

    const resetResponse = await failingApp.request("/economics/connectors/llm_token_metering/reset", {
      method: "POST",
    });
    expect(resetResponse.status).toBe(200);
    const resetHealth = (await resetResponse.json()) as {
      state: string;
      consecutiveFailures: number;
      lastError?: string;
    };
    expect(resetHealth.state).toBe("closed");
    expect(resetHealth.consecutiveFailures).toBe(0);
    expect(resetHealth.lastError).toBeUndefined();
  });
});

function buildSettlementModel(settlementId: string) {
  return {
    mode: "multi_asset" as const,
    legs: [
      {
        id: `${settlementId}-leg-1`,
        payerId: "issuer-1",
        payeeId: "agent-1",
        assetId: "usdc-mainnet",
        amount: 12,
        unit: "USDC",
      },
      {
        id: `${settlementId}-leg-2`,
        payerId: "issuer-1",
        payeeId: "agent-1",
        assetId: "llm-gpt5",
        amount: 150000,
        unit: "token",
      },
      {
        id: `${settlementId}-leg-3`,
        payerId: "issuer-1",
        payeeId: "agent-1",
        assetId: "cloud-aws",
        amount: 3,
        unit: "credit",
      },
      {
        id: `${settlementId}-leg-4`,
        payerId: "issuer-1",
        payeeId: "agent-1",
        assetId: "search-api",
        amount: 2400,
        unit: "request",
      },
    ],
  };
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

async function registerAssetsForEconomics(economics: PactEconomics): Promise<void> {
  await economics.registerAsset({ id: "usdc-mainnet", kind: "usdc", symbol: "USDC" });
  await economics.registerAsset({ id: "llm-gpt5", kind: "llm_token", symbol: "TOKEN" });
  await economics.registerAsset({ id: "cloud-aws", kind: "cloud_credit", symbol: "AWSC" });
  await economics.registerAsset({ id: "search-api", kind: "api_quota", symbol: "QPS" });
}
