import type {
  SettlementConnectorFailure,
  SettlementConnectorHealth,
  SettlementConnectorRequest,
  SettlementConnectorResult,
  SettlementConnectorRetryPolicy,
} from "../../application/settlement-connectors";

export interface InMemorySettlementConnectorOptions {
  retryPolicy?: Partial<SettlementConnectorRetryPolicy>;
}

const DEFAULT_RETRY_POLICY: SettlementConnectorRetryPolicy = {
  maxRetries: 2,
  backoffMs: 10,
};

export abstract class InMemorySettlementConnectorBase {
  private readonly processedResults = new Map<string, SettlementConnectorResult>();
  private readonly externalReferences = new Set<string>();
  private readonly retryPolicy: SettlementConnectorRetryPolicy;
  private readonly plannedFailures: string[] = [];
  private lastFailure?: SettlementConnectorFailure;
  private state: SettlementConnectorHealth["state"] = "healthy";

  protected constructor(options: InMemorySettlementConnectorOptions = {}) {
    this.retryPolicy = {
      maxRetries: this.normalizeRetryCount(options.retryPolicy?.maxRetries),
      backoffMs: this.normalizeBackoffMs(options.retryPolicy?.backoffMs),
    };
  }

  getHealth(): SettlementConnectorHealth {
    return {
      state: this.state,
      retryPolicy: { ...this.retryPolicy },
      lastFailure: this.lastFailure ? { ...this.lastFailure } : undefined,
    };
  }

  async hasExternalReference(externalReference: string): Promise<boolean> {
    return this.externalReferences.has(externalReference);
  }

  queueFailure(message = "planned connector failure", count = 1): void {
    const iterations = Number.isInteger(count) && count > 0 ? count : 1;
    for (let index = 0; index < iterations; index += 1) {
      this.plannedFailures.push(message);
    }
  }

  protected async executeWithResilience(
    input: SettlementConnectorRequest,
    operation: () => SettlementConnectorResult,
  ): Promise<SettlementConnectorResult> {
    const existingResult = input.idempotencyKey
      ? this.processedResults.get(input.idempotencyKey)
      : undefined;
    if (existingResult) {
      return this.cloneResult(existingResult);
    }

    const maxAttempts = this.retryPolicy.maxRetries + 1;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt += 1;

      try {
        const plannedFailure = this.plannedFailures.shift();
        if (plannedFailure) {
          throw new Error(plannedFailure);
        }

        const result = operation();
        this.state = "healthy";

        if (input.idempotencyKey) {
          this.processedResults.set(input.idempotencyKey, this.cloneResult(result));
        }
        this.externalReferences.add(result.externalReference);

        return this.cloneResult(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.lastFailure = {
          attempt,
          failedAt: Date.now(),
          message,
          settlementId: input.settlementId,
          recordId: input.recordId,
          idempotencyKey: input.idempotencyKey,
        };

        if (attempt >= maxAttempts) {
          this.state = "unhealthy";
          throw error instanceof Error ? error : new Error(message);
        }

        this.state = "degraded";
        await this.sleep(this.retryPolicy.backoffMs * attempt);
      }
    }

    throw new Error("connector execution failed");
  }

  private cloneResult(result: SettlementConnectorResult): SettlementConnectorResult {
    return {
      ...result,
      metadata: result.metadata ? { ...result.metadata } : undefined,
    };
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private normalizeRetryCount(value: number | undefined): number {
    if (value === undefined) {
      return DEFAULT_RETRY_POLICY.maxRetries;
    }
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`invalid maxRetries: ${value}`);
    }
    return value;
  }

  private normalizeBackoffMs(value: number | undefined): number {
    if (value === undefined) {
      return DEFAULT_RETRY_POLICY.backoffMs;
    }
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`invalid backoffMs: ${value}`);
    }
    return Math.floor(value);
  }
}
