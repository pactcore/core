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
        PACT_LLM_SETTLEMENT_PROFILE_JSON: JSON.stringify({
          providerId: "openai",
          id: "openai-prod",
          endpoint: "https://billing.example.test/llm",
          credentialType: "bearer",
        }),
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

  it("wires env-configured governance and rewards bridges through the container", async () => {
    const rpc = new MockRpcProvider();
    let txSequence = 0;
    rpc.setMethodResponse("eth_sendRawTransaction", () => {
      txSequence += 1;
      return `0xlive-bridge-${txSequence}`;
    });

    const container = createContainer(undefined, {
      env: {
        PACT_EVM_RPC_URL: "https://rpc.example.test",
        PACT_EVM_PRIVATE_KEY: "live-onchain-signer",
        PACT_GOVERNANCE_CONTRACT_ADDRESS: "0x7777777777777777777777777777777777777777",
        PACT_REWARDS_CONTRACT_ADDRESS: "0x8888888888888888888888888888888888888888",
        PACT_ONCHAIN_CONFIRMATION_DEPTH: "4",
        PACT_ONCHAIN_FINALITY_DEPTH: "9",
      },
      onchainRpcProvider: rpc,
    });

    const proposal = await container.pactOnchain.createGovernanceProposal({
      proposerId: "council-1",
      title: "Ship live governance bridge wiring",
      description: "Use env-backed onchain bridge configuration in the container runtime",
      votingEndsAt: Date.now() + 60_000,
    });
    const rewards = await container.pactOnchain.syncEpochRewards(12, [
      {
        participantId: "agent-7",
        amountCents: 2_500,
      },
    ]);

    const sendCalls = rpc.getCalls("eth_sendRawTransaction");
    expect(sendCalls).toHaveLength(2);
    expect(decodeSignedPayload(sendCalls[0]?.params[0]).to).toBe(
      "0x7777777777777777777777777777777777777777",
    );
    expect(decodeSignedPayload(sendCalls[1]?.params[0]).to).toBe(
      "0x8888888888888888888888888888888888888888",
    );
    expect(proposal.creationTxId).toBe("0xlive-bridge-1");
    expect(rewards.txId).toBe("0xlive-bridge-2");
    expect(container.pactOnchain.getFinalitySummary()).toMatchObject({
      submittedCount: 2,
      confirmationDepth: 4,
      finalityDepth: 9,
    });
    expect(container.pactOnchain.getTransaction(proposal.creationTxId)?.operation).toBe(
      "governance_proposal_create",
    );
    expect(container.pactOnchain.getTransaction(rewards.txId)?.operation).toBe("rewards_epoch_sync");
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

function decodeSignedPayload(rawTx: unknown): { from: string; to: string; data: string; nonce: number } {
  if (typeof rawTx !== "string") {
    throw new Error(`Expected raw transaction as hex string, received ${typeof rawTx}`);
  }

  return JSON.parse(Buffer.from(rawTx.slice(2), "hex").toString("utf8")) as {
    from: string;
    to: string;
    data: string;
    nonce: number;
  };
}
