import { describe, expect, it } from "bun:test";
import type {
  OnchainFinalityProvider,
  OnchainFinalitySummary,
  OnchainIndexerHookEvent,
  OnchainTransactionPage,
  OnchainTransactionQuery,
  OnchainTransactionRecord,
  SettlementConnectorProviderProfile,
  SettlementConnectorRequest,
  SettlementConnectorTransport,
  SettlementConnectorTransportRequest,
  SettlementConnectorTransportResponse,
  TransactionSigner,
  UnsignedSerializedTransaction,
} from "../src";
import {
  EvmBlockchainGateway,
  ExternalApiQuotaAllocationConnector,
  ExternalCloudCreditBillingConnector,
  ExternalLlmTokenMeteringConnector,
  InMemoryDurableSettlementRecordRepository,
  MockEvmGovernanceBridge,
  MockEvmRewardsBridge,
  MockRpcProvider,
  OnchainFinalityRuntime,
  PactEconomics,
  PactOnchain,
  hexEncodeUtf8,
  normalizeLikeAddress,
} from "../src";
import type { ContractAddresses } from "../src/blockchain/contract-abis";

const CONTRACT_ADDRESSES: ContractAddresses = {
  escrow: "0x1111111111111111111111111111111111111111",
  identitySBT: "0x2222222222222222222222222222222222222222",
  staking: "0x3333333333333333333333333333333333333333",
  payRouter: "0x4444444444444444444444444444444444444444",
};

describe("Live settlement adapters and onchain bridge hardening", () => {
  it("builds provider-authenticated external settlement requests", async () => {
    const transport = new RecordingTransport(({ operation }) => ({
      status: 201,
      body: {
        externalReference: `ext-${operation}`,
        processedAt: 1_111,
        metadata: {
          upstream: "settlement-core",
          accepted: true,
          retryAttempt: 2,
        },
      },
    }));
    const connector = new ExternalLlmTokenMeteringConnector({
      transport,
      providerProfile: {
        id: "openai-live",
        providerId: "openai",
        endpoint: "https://billing.example.test/llm/credits",
        credentialSchema: {
          type: "bearer",
          fields: [{ key: "token", required: true, secret: true }],
        },
        credentials: {
          token: "live-secret-token",
        },
      },
      timeoutMs: 500,
    });

    const result = await connector.applyMeteringCredit(buildRequest());

    expect(result.externalReference).toBe("ext-apply_metering_credit");
    expect(result.metadata).toMatchObject({
      providerId: "openai",
      profileId: "openai-live",
      connector: "llm_token_metering",
      operation: "apply_metering_credit",
      httpStatus: "201",
      upstream: "settlement-core",
      accepted: "true",
      retryAttempt: "2",
    });
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.headers.authorization).toBe("Bearer live-secret-token");
    expect(transport.requests[0]?.headers["idempotency-key"]).toBeUndefined();
    expect(transport.requests[0]?.headers["x-pact-provider-profile"]).toBe("openai-live");
    expect(transport.requests[0]?.headers["x-pact-request-digest"]?.startsWith("sha256:")).toBe(true);
    const payload = JSON.parse(transport.requests[0]?.body ?? "{}");
    expect(payload.connector).toBe("llm_token_metering");
    expect(payload.connectorPayload).toMatchObject({
      creditedAmount: 100,
      billingUnit: "token",
      beneficiaryId: "agent-1",
    });
  });

  it("validates optional settlement transport digest headers", async () => {
    const transport = new RecordingTransport(async (request) => {
      const body = {
        externalReference: "ext-digest",
        processedAt: 1_222,
      };

      return {
        status: 200,
        body,
        headers: {
          "x-pact-request-digest": request.headers["x-pact-request-digest"] ?? "",
          "x-pact-response-digest": await createDigest(JSON.stringify(body)),
        },
      };
    });
    const connector = new ExternalLlmTokenMeteringConnector({
      transport,
      providerProfile: {
        id: "openai-live-digest",
        providerId: "openai",
        endpoint: "https://billing.example.test/llm/credits",
        credentialSchema: {
          type: "bearer",
          fields: [{ key: "token", required: true, secret: true }],
        },
        credentials: {
          token: "digest-secret-token",
        },
      },
      timeoutMs: 500,
    });

    const result = await connector.applyMeteringCredit(buildRequest({
      settlementId: "settlement-digest-1",
      recordId: "record-digest-1",
      legId: "leg-digest-1",
    }));

    expect(result.externalReference).toBe("ext-digest");
    expect(result.metadata).toMatchObject({
      requestDigestValidated: "true",
      responseDigestValidated: "true",
    });
  });

  it("accepts aliased provider credential keys for live settlement auth", async () => {
    const transport = new RecordingTransport(() => ({
      status: 200,
      body: {
        externalReference: "ext-alias",
        processedAt: 1_500,
      },
    }));
    const connector = new ExternalLlmTokenMeteringConnector({
      transport,
      providerProfile: {
        id: "openai-live-alias",
        providerId: "openai",
        endpoint: "https://billing.example.test/llm/credits",
        credentialSchema: {
          type: "bearer",
          fields: [{ key: "token", required: true, secret: true }],
        },
        credentials: {
          access_token: "alias-secret-token",
        },
      },
      timeoutMs: 500,
    });

    const result = await connector.applyMeteringCredit(buildRequest({
      settlementId: "settlement-alias-1",
      recordId: "record-alias-1",
      legId: "leg-alias-1",
    }));

    expect(result.externalReference).toBe("ext-alias");
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.headers.authorization).toBe("Bearer alias-secret-token");
    expect(connector.getHealth().profile?.requiredCredentialFields).toEqual(["token"]);
    expect(connector.getHealth().profile?.configuredCredentialFields).toEqual(["token"]);
  });

  it("rejects mismatched settlement transport digest headers", async () => {
    const transport = new RecordingTransport(() => ({
      status: 200,
      body: {
        externalReference: "ext-digest-bad",
        processedAt: 1_333,
      },
      headers: {
        "x-pact-request-digest": "sha256:wrong",
      },
    }));
    const connector = new ExternalLlmTokenMeteringConnector({
      transport,
      providerProfile: {
        id: "openai-live-digest-bad",
        providerId: "openai",
        endpoint: "https://billing.example.test/llm/credits",
        credentialSchema: {
          type: "bearer",
          fields: [{ key: "token", required: true, secret: true }],
        },
        credentials: {
          token: "digest-secret-token",
        },
      },
      timeoutMs: 500,
    });

    await expect(
      connector.applyMeteringCredit(buildRequest({
        settlementId: "settlement-digest-2",
        recordId: "record-digest-2",
        legId: "leg-digest-2",
      })),
    ).rejects.toThrow("external settlement transport request digest mismatch");
  });

  it("executes settlement records through live-facing llm/cloud/api transports", async () => {
    const transport = new RecordingTransport((request): SettlementConnectorTransportResponse => ({
      status: 200,
      body: {
        externalReference: `${request.connector}-ref-${transport.requests.length + 1}`,
        processedAt: 2_000,
        metadata: {
          acceptedOperation: request.operation,
          delivered: true,
        },
      },
    }));
    const economics = new PactEconomics({
      settlementRecordRepository: new InMemoryDurableSettlementRecordRepository(),
      settlementConnectors: {
        llmTokenMetering: new ExternalLlmTokenMeteringConnector({
          transport,
          providerProfile: buildProviderProfile({
            id: "openai-profile",
            providerId: "openai",
            endpoint: "https://billing.example.test/llm",
            credentialType: "bearer",
            credentials: { token: "openai-token" },
          }),
        }),
        cloudCreditBilling: new ExternalCloudCreditBillingConnector({
          transport,
          providerProfile: buildProviderProfile({
            id: "aws-profile",
            providerId: "aws",
            endpoint: "https://billing.example.test/cloud",
            credentialType: "basic",
            credentials: { username: "aws-user", password: "aws-pass" },
          }),
        }),
        apiQuotaAllocation: new ExternalApiQuotaAllocationConnector({
          transport,
          providerProfile: buildProviderProfile({
            id: "search-profile",
            providerId: "search-api",
            endpoint: "https://billing.example.test/api",
            credentialType: "api_key",
            credentials: { apiKey: "search-key" },
          }),
        }),
      },
    });
    await registerManagedAssets(economics);

    const result = await economics.executeSettlement({
      settlementId: "settlement-live-1",
      idempotencyKey: "live-1",
      model: {
        mode: "multi_asset",
        legs: [
          {
            id: "leg-1",
            payerId: "issuer-1",
            payeeId: "agent-1",
            assetId: "llm-gpt5",
            amount: 120_000,
            unit: "token",
          },
          {
            id: "leg-2",
            payerId: "issuer-1",
            payeeId: "agent-1",
            assetId: "cloud-aws",
            amount: 4,
            unit: "credit",
          },
          {
            id: "leg-3",
            payerId: "issuer-1",
            payeeId: "agent-1",
            assetId: "search-api",
            amount: 8_000,
            unit: "request",
          },
        ],
      },
    });

    expect(result.records).toHaveLength(3);
    expect(transport.requests).toHaveLength(3);
    expect(transport.requests[0]?.headers.authorization).toBe("Bearer openai-token");
    expect(transport.requests[0]?.headers["idempotency-key"]).toBe("live-1:leg-1");
    expect(transport.requests[0]?.headers["x-pact-request-digest"]?.startsWith("sha256:")).toBe(true);
    expect(transport.requests[1]?.headers.authorization).toBe(
      `Basic ${Buffer.from("aws-user:aws-pass").toString("base64")}`,
    );
    expect(transport.requests[1]?.headers["idempotency-key"]).toBe("live-1:leg-2");
    expect(transport.requests[2]?.headers["x-api-key"]).toBe("search-key");
    expect(transport.requests[2]?.headers["idempotency-key"]).toBe("live-1:leg-3");
    expect(result.records.every((record) => record.connectorMetadata?.acceptedOperation)).toBeTrue();
    expect(result.records.every((record) => record.connectorMetadata?.delivered === "true")).toBeTrue();
  });

  it("uses injected signer abstractions for contract bridge transactions", async () => {
    const signer = new RecordingSigner("custom-gateway-signer");
    const rpc = new MockRpcProvider();
    rpc.setMethodResponse("eth_sendRawTransaction", "0xbridge-tx");
    const gateway = new EvmBlockchainGateway({
      rpcUrl: "http://localhost:8545",
      contractAddresses: CONTRACT_ADDRESSES,
      rpcProvider: rpc,
      signer,
    });

    await gateway.createEscrow("task-7", "payer-1", 5_000);

    expect(signer.signedPayloads).toHaveLength(1);
    expect(signer.signedPayloads[0]).toMatchObject({
      to: CONTRACT_ADDRESSES.escrow,
      nonce: 0,
    });
    const rawTx = rpc.getCalls("eth_sendRawTransaction")[0]?.params[0];
    const payload = decodeSignedPayload(rawTx);
    expect(payload.from).toBe(signer.getAddress());
    expect(payload.to).toBe(CONTRACT_ADDRESSES.escrow);
  });

  it("emits indexer hooks for inclusion, finality, and reorg transitions", () => {
    let now = 100;
    const events: OnchainIndexerHookEvent[] = [];
    const runtime = new OnchainFinalityRuntime({
      now: () => now,
      confirmationDepth: 1,
      finalityDepth: 2,
      hooks: [(event) => {
        events.push(event);
      }],
    });

    runtime.trackTransaction({
      txId: "0xtx-1",
      operation: "governance_proposal_create",
      submittedAt: now,
      proposalId: "proposal-1",
      referenceId: "proposal-1",
    });
    now = 110;
    runtime.recordTransactionInclusion({
      txId: "0xtx-1",
      blockNumber: 10,
      blockHash: "0xblock-10-a",
      includedAt: now,
    });
    now = 120;
    runtime.advanceHead(10, "0xblock-10-a");
    now = 130;
    runtime.advanceHead(11, "0xblock-11-a");
    now = 140;
    runtime.recordCanonicalBlock({ blockNumber: 10, blockHash: "0xblock-10-b" });

    expect(events.map((event) => event.kind)).toEqual([
      "tracked",
      "included",
      "status_changed",
      "status_changed",
      "finalized",
      "status_changed",
      "reorged",
    ]);
    expect(events.at(-1)?.transaction.status).toBe("reorged");
    expect(events.at(-1)?.previousTransaction?.status).toBe("finalized");
  });

  it("accepts pluggable finality providers in PactOnchain", async () => {
    const finalityProvider = new CapturingFinalityProvider();
    const onchain = new PactOnchain(
      new MockEvmGovernanceBridge({ now: () => 1_000 }),
      new MockEvmRewardsBridge({ now: () => 1_000 }),
      finalityProvider,
    );

    const proposal = await onchain.createGovernanceProposal({
      proposerId: "council-1",
      title: "Harden finality provider hooks",
      description: "Allow custom providers and indexer callbacks",
      votingEndsAt: 5_000,
    });

    expect(finalityProvider.tracked).toHaveLength(1);
    expect(finalityProvider.tracked[0]).toMatchObject({
      txId: proposal.creationTxId,
      operation: "governance_proposal_create",
      proposalId: proposal.id,
    });
  });
});

class RecordingTransport implements SettlementConnectorTransport {
  readonly requests: SettlementConnectorTransportRequest[] = [];

  constructor(
    private readonly responseFactory: (
      request: SettlementConnectorTransportRequest,
    ) => SettlementConnectorTransportResponse | Promise<SettlementConnectorTransportResponse>,
  ) {}

  async send(request: SettlementConnectorTransportRequest): Promise<SettlementConnectorTransportResponse> {
    this.requests.push({
      ...request,
      headers: { ...request.headers },
    });
    return await this.responseFactory(request);
  }
}

class RecordingSigner implements TransactionSigner {
  readonly signedPayloads: UnsignedSerializedTransaction[] = [];
  private readonly address: string;

  constructor(seed: string) {
    this.address = normalizeLikeAddress(seed);
  }

  getAddress(): string {
    return this.address;
  }

  async signTransaction(payload: UnsignedSerializedTransaction): Promise<string> {
    this.signedPayloads.push({ ...payload });
    return hexEncodeUtf8(
      JSON.stringify({
        from: this.address,
        ...payload,
      }),
    );
  }
}

class CapturingFinalityProvider implements OnchainFinalityProvider {
  readonly tracked: Array<{
    txId: string;
    operation: OnchainTransactionRecord["operation"];
    proposalId?: string;
  }> = [];

  trackTransaction(input: {
    txId: string;
    operation: OnchainTransactionRecord["operation"];
    proposalId?: string;
  }): OnchainTransactionRecord {
    this.tracked.push({ ...input });
    return buildTransactionRecord(input.txId, input.operation);
  }

  recordTransactionInclusion(): OnchainTransactionRecord {
    return buildTransactionRecord("0xnoop", "governance_proposal_create");
  }

  recordCanonicalBlock(): void {}

  advanceHead(): OnchainFinalitySummary {
    return this.getSummary();
  }

  getTransaction(): OnchainTransactionRecord | undefined {
    return undefined;
  }

  listTransactions(_query?: OnchainTransactionQuery): OnchainTransactionPage {
    return { items: [] };
  }

  getSummary(): OnchainFinalitySummary {
    return {
      trackedTransactionCount: this.tracked.length,
      submittedCount: this.tracked.length,
      confirmedCount: 0,
      finalizedCount: 0,
      reorgedCount: 0,
      confirmationDepth: 2,
      finalityDepth: 6,
    };
  }
}

function buildProviderProfile(input: {
  id: string;
  providerId: string;
  endpoint: string;
  credentialType: SettlementConnectorProviderProfile["credentialSchema"]["type"];
  credentials: Record<string, string>;
}): SettlementConnectorProviderProfile {
  return {
    id: input.id,
    providerId: input.providerId,
    endpoint: input.endpoint,
    credentialSchema: {
      type: input.credentialType,
      fields: Object.keys(input.credentials).map((key) => ({ key, required: true, secret: true })),
    },
    credentials: input.credentials,
  };
}

function buildRequest(overrides: Partial<SettlementConnectorRequest> = {}): SettlementConnectorRequest {
  return {
    settlementId: overrides.settlementId ?? "settlement-1",
    recordId: overrides.recordId ?? "record-1",
    legId: overrides.legId ?? "leg-1",
    assetId: overrides.assetId ?? "llm-gpt5",
    payerId: overrides.payerId ?? "issuer-1",
    payeeId: overrides.payeeId ?? "agent-1",
    amount: overrides.amount ?? 100,
    unit: overrides.unit ?? "token",
    idempotencyKey: overrides.idempotencyKey,
  };
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

function buildTransactionRecord(
  txId: string,
  operation: OnchainTransactionRecord["operation"],
): OnchainTransactionRecord {
  return {
    txId,
    operation,
    status: "submitted",
    submittedAt: 0,
    lastUpdatedAt: 0,
    confirmations: 0,
    confirmationDepth: 2,
    finalityDepth: 6,
  };
}

async function registerManagedAssets(economics: PactEconomics): Promise<void> {
  await economics.registerAsset({ id: "llm-gpt5", kind: "llm_token", symbol: "TOKEN" });
  await economics.registerAsset({ id: "cloud-aws", kind: "cloud_credit", symbol: "AWSC" });
  await economics.registerAsset({ id: "search-api", kind: "api_quota", symbol: "QPS" });
}

async function createDigest(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return `sha256:${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
