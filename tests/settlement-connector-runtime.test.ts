import { describe, expect, it } from "bun:test";
import type {
  SettlementConnectorProviderProfile,
  SettlementConnectorRequest,
  SettlementConnectorResult,
} from "../src/application/settlement-connectors";
import {
  InMemorySettlementConnectorBase,
  type InMemorySettlementConnectorOptions,
} from "../src/infrastructure/settlement/in-memory-settlement-connector-base";

describe("Settlement connector runtime hardening", () => {
  it("validates provider auth profiles and redacts credential values from health", () => {
    const connector = new TestSettlementConnector({
      timeoutMs: 250,
      retryPolicy: {
        maxRetries: 2,
        backoffMs: 5,
        backoffStrategy: "exponential",
        maxBackoffMs: 20,
      },
      providerProfile: buildProviderProfile(),
    });

    const health = connector.getHealth();

    expect(health.timeoutMs).toBe(250);
    expect(health.retryPolicy.backoffStrategy).toBe("exponential");
    expect(health.retryPolicy.maxBackoffMs).toBe(20);
    expect(health.profile).toEqual({
      profileId: "openai-settlement",
      providerId: "openai",
      displayName: "OpenAI settlement runtime",
      endpoint: "https://settlement.example.test/v1/credits",
      credentialType: "bearer",
      requiredCredentialFields: ["token"],
      configuredCredentialFields: ["region", "token"],
    });
    expect(JSON.stringify(health)).not.toContain("super-secret-token");
  });

  it("rejects malformed provider credential profiles", () => {
    expect(
      () =>
        new TestSettlementConnector({
          providerProfile: {
            ...buildProviderProfile(),
            credentials: {
              region: "us-east-1",
            },
          },
        }),
    ).toThrow("missing provider credential field: token");
  });

  it("times out attempts and opens the breaker after timeout failures", async () => {
    const connector = new TestSettlementConnector({
      timeoutMs: 10,
      retryPolicy: {
        maxRetries: 0,
        backoffMs: 0,
      },
      circuitBreaker: {
        failureThreshold: 1,
        cooldownMs: 60_000,
      },
    });
    connector.queueDelay(30);

    await expect(connector.apply(buildRequest({ idempotencyKey: "timeout-1" }))).rejects.toThrow(
      "connector attempt timed out after 10ms",
    );

    const health = connector.getHealth();
    expect(health.state).toBe("open");
    expect(health.lastError).toBe("connector attempt timed out after 10ms");
    expect(health.lastFailure?.attempt).toBe(1);
  });

  it("deduplicates concurrent in-flight executions by idempotency key", async () => {
    const connector = new TestSettlementConnector({ timeoutMs: 100 });
    const request = buildRequest({ idempotencyKey: "concurrent-1" });
    connector.queueDelay(25);

    const [first, second] = await Promise.all([connector.apply(request), connector.apply({ ...request })]);

    expect(connector.attempts).toBe(1);
    expect(first.metadata?.attempts).toBe("1");
    expect(second.metadata?.attempts).toBe("1");
    expect(first.metadata?.balance).toBe("100");
    expect(second.metadata?.balance).toBe("100");
  });

  it("rejects connector idempotency key reuse with a different request payload", async () => {
    const connector = new TestSettlementConnector();

    await connector.apply(buildRequest({ idempotencyKey: "idem-1" }));

    await expect(
      connector.apply(
        buildRequest({
          idempotencyKey: "idem-1",
          amount: 250,
        }),
      ),
    ).rejects.toThrow("connector idempotency key reuse with different request: idem-1");
  });
});

class TestSettlementConnector extends InMemorySettlementConnectorBase {
  attempts = 0;
  private balance = 0;

  constructor(options: InMemorySettlementConnectorOptions = {}) {
    super(options);
  }

  async apply(input: SettlementConnectorRequest): Promise<SettlementConnectorResult> {
    return this.executeWithResilience(input, async () => {
      this.attempts += 1;
      this.balance += input.amount;

      return {
        status: "applied",
        externalReference: `test-${input.recordId}`,
        processedAt: Date.now(),
        metadata: {
          attempts: String(this.attempts),
          balance: String(this.balance),
        },
      };
    });
  }
}

function buildProviderProfile(): SettlementConnectorProviderProfile {
  return {
    id: "openai-settlement",
    providerId: "openai",
    displayName: "OpenAI settlement runtime",
    endpoint: "https://settlement.example.test/v1/credits",
    timeoutMs: 250,
    credentialSchema: {
      type: "bearer",
      fields: [
        { key: "token", required: true, secret: true },
        { key: "region", required: false },
      ],
    },
    credentials: {
      token: "super-secret-token",
      region: "us-east-1",
    },
    metadata: {
      environment: "test",
    },
  };
}

function buildRequest(
  overrides: Partial<SettlementConnectorRequest> = {},
): SettlementConnectorRequest {
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
