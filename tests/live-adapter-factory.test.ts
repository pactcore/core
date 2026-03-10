import { describe, expect, it } from "bun:test";
import type {
  SettlementConnectorTransport,
  SettlementConnectorTransportRequest,
  SettlementConnectorTransportResponse,
} from "../src";
import {
  LiveOnchainIndexer,
  MockRpcProvider,
  OnchainFinalityRuntime,
  RpcOnchainIndexerDataSource,
  createContainer,
  loadSettlementConnectorProviderProfilesFromEnv,
} from "../src";

describe("Live adapter factories", () => {
  it("loads settlement provider profiles from env-backed schemas", () => {
    const profiles = loadSettlementConnectorProviderProfilesFromEnv({
      PACT_LLM_SETTLEMENT_PROVIDER_ID: "openai",
      PACT_LLM_SETTLEMENT_PROFILE_ID: "openai-prod",
      PACT_LLM_SETTLEMENT_DISPLAY_NAME: "OpenAI Billing",
      PACT_LLM_SETTLEMENT_ENDPOINT: "https://billing.example.test/llm",
      PACT_LLM_SETTLEMENT_CREDENTIAL_TYPE: "bearer",
      PACT_LLM_SETTLEMENT_CREDENTIAL_TOKEN: "secret-token",
      PACT_LLM_SETTLEMENT_METADATA_REGION: "us-east-1",
    });

    expect(profiles.llmTokenMetering).toMatchObject({
      id: "openai-prod",
      providerId: "openai",
      displayName: "OpenAI Billing",
      endpoint: "https://billing.example.test/llm",
      credentialSchema: {
        type: "bearer",
        fields: [{ key: "token", required: true, secret: true }],
      },
      credentials: {
        token: "secret-token",
      },
      metadata: {
        region: "us-east-1",
      },
    });
    expect(profiles.cloudCreditBilling).toBeUndefined();
    expect(profiles.apiQuotaAllocation).toBeUndefined();
  });

  it("accepts aliased bearer credentials from env-backed settlement profiles", async () => {
    const transport = new SequencedTransport([
      {
        status: 200,
        body: {
          externalReference: "llm-ref-alias",
          processedAt: 1_500,
        },
      },
    ]);
    const container = createContainer(undefined, {
      env: {
        PACT_LLM_SETTLEMENT_PROVIDER_ID: "openai",
        PACT_LLM_SETTLEMENT_PROFILE_ID: "openai-alias",
        PACT_LLM_SETTLEMENT_ENDPOINT: "https://billing.example.test/llm",
        PACT_LLM_SETTLEMENT_CREDENTIAL_TYPE: "bearer",
        PACT_LLM_SETTLEMENT_CREDENTIAL_ACCESS_TOKEN: "openai-alias-secret",
      },
      settlementTransport: transport,
    });

    await container.pactEconomics.registerAsset({
      id: "llm-gpt5",
      kind: "llm_token",
      symbol: "TOK",
    });

    const result = await container.pactEconomics.executeSettlement({
      settlementId: "settlement-live-alias",
      idempotencyKey: "settlement-live-alias",
      model: {
        mode: "multi_asset",
        legs: [
          {
            id: "leg-1",
            payerId: "issuer-1",
            payeeId: "agent-1",
            assetId: "llm-gpt5",
            amount: 10,
            unit: "token",
          },
        ],
      },
    });

    expect(result.records).toHaveLength(1);
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.headers.authorization).toBe("Bearer openai-alias-secret");
    const health = container.pactEconomics.getConnectorHealth().find((entry) => entry.connector === "llm_token_metering");
    expect(health?.profile?.configuredCredentialFields).toEqual(["token"]);
  });

  it("wires env-configured live settlement adapters with retries and idempotency", async () => {
    const transport = new SequencedTransport([
      {
        status: 503,
        body: { message: "try again" },
      },
      {
        status: 200,
        body: {
          externalReference: "llm-ref-1",
          processedAt: 1_234,
          metadata: {
            upstream: "live-billing",
          },
        },
      },
    ]);

    const container = createContainer(undefined, {
      env: {
        PACT_LLM_SETTLEMENT_PROVIDER_ID: "openai",
        PACT_LLM_SETTLEMENT_PROFILE_ID: "openai-prod",
        PACT_LLM_SETTLEMENT_ENDPOINT: "https://billing.example.test/llm",
        PACT_LLM_SETTLEMENT_CREDENTIAL_TYPE: "bearer",
        PACT_LLM_SETTLEMENT_CREDENTIAL_TOKEN: "openai-secret",
        PACT_ONCHAIN_CONFIRMATION_DEPTH: "3",
        PACT_ONCHAIN_FINALITY_DEPTH: "5",
      },
      settlementTransport: transport,
    });

    await container.pactEconomics.registerAsset({
      id: "llm-gpt5",
      kind: "llm_token",
      symbol: "TOK",
    });

    const first = await container.pactEconomics.executeSettlement({
      settlementId: "settlement-live-retry",
      idempotencyKey: "settlement-live-retry",
      model: {
        mode: "multi_asset",
        legs: [
          {
            id: "leg-1",
            payerId: "issuer-1",
            payeeId: "agent-1",
            assetId: "llm-gpt5",
            amount: 42,
            unit: "token",
          },
        ],
      },
    });
    const second = await container.pactEconomics.executeSettlement({
      settlementId: "settlement-live-retry",
      idempotencyKey: "settlement-live-retry",
      model: {
        mode: "multi_asset",
        legs: [
          {
            id: "leg-1",
            payerId: "issuer-1",
            payeeId: "agent-1",
            assetId: "llm-gpt5",
            amount: 42,
            unit: "token",
          },
        ],
      },
    });

    expect(first.records).toHaveLength(1);
    expect(second.records).toHaveLength(1);
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[0]?.headers.authorization).toBe("Bearer openai-secret");
    expect(transport.requests[0]?.headers["idempotency-key"]).toBe("settlement-live-retry:leg-1");
    expect(transport.requests[0]?.headers["x-pact-request-digest"]?.startsWith("sha256:")).toBe(true);
    expect(first.records[0]?.externalReference).toBe("llm-ref-1");
    expect(second.records[0]?.externalReference).toBe("llm-ref-1");

    const health = container.pactEconomics.getConnectorHealth().find((entry) => entry.connector === "llm_token_metering");
    expect(health?.profile).toMatchObject({
      profileId: "openai-prod",
      providerId: "openai",
      credentialType: "bearer",
      configuredCredentialFields: ["token"],
    });
    expect(container.pactOnchain.getFinalitySummary()).toMatchObject({
      confirmationDepth: 3,
      finalityDepth: 5,
    });
  });

  it("syncs live RPC finality progression and reorgs through indexer abstractions", async () => {
    let canonicalBlockHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const rpc = new MockRpcProvider();
    rpc.setMethodResponse("eth_getTransactionReceipt", {
      transactionHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      blockNumber: "0xa",
      blockHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    rpc.setMethodResponse("eth_getBlockByNumber", (request: { params: unknown[] }) => {
      const tag = request.params[0];
      if (tag === "latest") {
        return {
          number: "0xb",
          hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          parentHash: canonicalBlockHash,
        };
      }

      return {
        number: "0xa",
        hash: canonicalBlockHash,
        parentHash: "0x9999999999999999999999999999999999999999999999999999999999999999",
      };
    });

    const events: string[] = [];
    const finality = new OnchainFinalityRuntime({
      confirmationDepth: 1,
      finalityDepth: 2,
      hooks: [(event) => {
        events.push(event.kind);
      }],
    });
    finality.trackTransaction({
      txId: "0x1111111111111111111111111111111111111111111111111111111111111111",
      operation: "governance_proposal_create",
      referenceId: "proposal-1",
    });

    const indexer = new LiveOnchainIndexer({
      dataSource: new RpcOnchainIndexerDataSource(rpc),
      finalityProvider: finality,
    });

    const finalized = await indexer.syncTransaction(
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
    expect(finalized?.status).toBe("finalized");
    expect(finalized?.confirmations).toBe(2);

    canonicalBlockHash = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const reorged = await indexer.syncTransaction(
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    );

    expect(reorged?.status).toBe("reorged");
    expect(reorged?.confirmations).toBe(0);
    expect(events).toContain("finalized");
    expect(events).toContain("reorged");
  });
});

class SequencedTransport implements SettlementConnectorTransport {
  readonly requests: SettlementConnectorTransportRequest[] = [];
  private cursor = 0;

  constructor(private readonly responses: SettlementConnectorTransportResponse[]) {}

  async send(request: SettlementConnectorTransportRequest): Promise<SettlementConnectorTransportResponse> {
    this.requests.push({
      ...request,
      headers: { ...request.headers },
      body: request.body,
    });

    const response = this.responses[this.cursor] ?? this.responses[this.responses.length - 1];
    this.cursor += 1;

    if (!response) {
      throw new Error("no transport response configured");
    }

    return response;
  }
}
