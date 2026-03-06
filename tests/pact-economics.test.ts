import { describe, expect, it } from "bun:test";
import { PactEconomics } from "../src/application/modules/pact-economics";
import { DomainEvents } from "../src/application/events";
import { InMemoryEventBus } from "../src/infrastructure/event-bus/in-memory-event-bus";
import { InMemoryEventJournal } from "../src/infrastructure/event-bus/in-memory-event-journal";
import { InMemoryApiQuotaAllocationConnector } from "../src/infrastructure/settlement/in-memory-api-quota-allocation-connector";
import { InMemoryCloudCreditBillingConnector } from "../src/infrastructure/settlement/in-memory-cloud-credit-billing-connector";
import { InMemoryLlmTokenMeteringConnector } from "../src/infrastructure/settlement/in-memory-llm-token-metering-connector";
import { InMemoryDurableSettlementRecordRepository } from "../src/infrastructure/repositories/in-memory-durable-settlement-record-repository";

describe("PactEconomics", () => {
  it("quotes multi-asset model in a reference asset", async () => {
    const economics = new PactEconomics({
      settlementRecordRepository: new InMemoryDurableSettlementRecordRepository(),
    });

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
    const economics = new PactEconomics({
      settlementRecordRepository: new InMemoryDurableSettlementRecordRepository(),
    });

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

  it("executes non-stablecoin settlement connectors with audit records and events", async () => {
    const journal = new InMemoryEventJournal();
    const eventBus = new InMemoryEventBus(journal);
    const economics = new PactEconomics({
      settlementRecordRepository: new InMemoryDurableSettlementRecordRepository(),
      eventBus,
      settlementConnectors: {
        llmTokenMetering: new InMemoryLlmTokenMeteringConnector(),
        cloudCreditBilling: new InMemoryCloudCreditBillingConnector(),
        apiQuotaAllocation: new InMemoryApiQuotaAllocationConnector(),
      },
    });

    await economics.registerAsset({ id: "usdc-mainnet", kind: "usdc", symbol: "USDC" });
    await economics.registerAsset({ id: "llm-gpt5", kind: "llm_token", symbol: "TOKEN" });
    await economics.registerAsset({ id: "cloud-aws", kind: "cloud_credit", symbol: "AWSC" });
    await economics.registerAsset({ id: "search-api", kind: "api_quota", symbol: "QPS" });

    const execution = await economics.executeSettlement({
      settlementId: "settlement-stage2",
      idempotencyKey: "settlement-stage2-key",
      model: {
        mode: "multi_asset",
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
            amount: 120000,
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
            amount: 8000,
            unit: "request",
          },
        ],
      },
    });

    expect(execution.records.length).toBe(3);
    expect(execution.records.find((record) => record.rail === "llm_metering")).toBeDefined();
    expect(execution.records.find((record) => record.rail === "cloud_billing")).toBeDefined();
    expect(execution.records.find((record) => record.rail === "api_quota")).toBeDefined();

    const listed = await economics.listSettlementRecords({
      settlementId: "settlement-stage2",
    });
    expect(listed.length).toBe(3);

    const single = await economics.getSettlementRecord(listed[0]!.id);
    expect(single?.settlementId).toBe("settlement-stage2");

    const reconciled = await economics.reconcileSettlementRecord({
      recordId: listed[0]!.id,
      reconciledBy: "auditor-1",
      note: "connector state verified",
    });
    expect(reconciled.status).toBe("reconciled");
    expect(reconciled.reconciledBy).toBe("auditor-1");

    const replay = await economics.replaySettlementRecordLifecycle({ fromOffset: 0, limit: 20 });
    expect(replay.entries.length).toBe(4);
    expect(replay.entries.some((entry) => entry.action === "reconciled")).toBeTrue();

    const events = await journal.replay(0, 20);
    const eventNames = events.map((entry) => entry.event.name);
    expect(
      eventNames.filter((name) => name === DomainEvents.EconomicsSettlementRecordCreated).length,
    ).toBe(3);
    expect(eventNames.includes(DomainEvents.EconomicsSettlementRecordReconciled)).toBeTrue();
    expect(eventNames.includes(DomainEvents.EconomicsSettlementExecuted)).toBeTrue();
  });

  it("requires idempotency keys for settlement execution", async () => {
    const economics = new PactEconomics({
      settlementRecordRepository: new InMemoryDurableSettlementRecordRepository(),
      settlementConnectors: {
        llmTokenMetering: new InMemoryLlmTokenMeteringConnector(),
        cloudCreditBilling: new InMemoryCloudCreditBillingConnector(),
        apiQuotaAllocation: new InMemoryApiQuotaAllocationConnector(),
      },
    });

    await economics.registerAsset({ id: "usdc-mainnet", kind: "usdc", symbol: "USDC" });
    await economics.registerAsset({ id: "llm-gpt5", kind: "llm_token", symbol: "TOKEN" });

    await expect(
      economics.executeSettlement({
        settlementId: "settlement-missing-idem",
        idempotencyKey: " ",
        model: {
          mode: "multi_asset",
          legs: [
            {
              id: "leg-1",
              payerId: "issuer-1",
              payeeId: "agent-1",
              assetId: "llm-gpt5",
              amount: 1,
              unit: "token",
            },
          ],
        },
      }),
    ).rejects.toThrow("idempotencyKey is required");
  });
});
