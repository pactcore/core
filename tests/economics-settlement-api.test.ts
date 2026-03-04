import { describe, expect, it } from "bun:test";
import { createApp } from "../src/api/app";

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
      headers: { "content-type": "application/json" },
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
});
