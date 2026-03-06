import type {
  SettlementConnectorCircuitBreakerPolicy,
  SettlementConnectorFailure,
  SettlementConnectorHealth,
  SettlementConnectorRequest,
  SettlementConnectorResult,
  SettlementConnectorRetryPolicy,
} from "../../application/settlement-connectors";

export interface InMemorySettlementConnectorOptions {
  retryPolicy?: Partial<SettlementConnectorRetryPolicy>;
  circuitBreaker?: Partial<SettlementConnectorCircuitBreakerPolicy>;
}

const DEFAULT_RETRY_POLICY: SettlementConnectorRetryPolicy = {
  maxRetries: 2,
  backoffMs: 10,
};

const DEFAULT_CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

export abstract class InMemorySettlementConnectorBase {
  private readonly processedResults = new Map<string, SettlementConnectorResult>();
  private readonly externalReferences = new Set<string>();
  private readonly retryPolicy: SettlementConnectorRetryPolicy;
  private readonly circuitBreaker: SettlementConnectorCircuitBreakerPolicy;
  private readonly plannedFailures: string[] = [];
  private consecutiveFailures = 0;
  private lastFailureAt?: number;
  private lastError?: string;
  private lastFailure?: SettlementConnectorFailure;
  private state: SettlementConnectorHealth["state"] = "closed";

  protected constructor(options: InMemorySettlementConnectorOptions = {}) {
    this.retryPolicy = {
      maxRetries: this.normalizeRetryCount(options.retryPolicy?.maxRetries),
      backoffMs: this.normalizeBackoffMs(options.retryPolicy?.backoffMs),
    };
    this.circuitBreaker = {
      failureThreshold: this.normalizeFailureThreshold(
        options.circuitBreaker?.failureThreshold,
        this.retryPolicy.maxRetries + 1,
      ),
      cooldownMs: this.normalizeCooldownMs(options.circuitBreaker?.cooldownMs),
    };
  }

  getHealth(): SettlementConnectorHealth {
    this.refreshCircuitBreakerState();

    return {
      state: this.state,
      retryPolicy: { ...this.retryPolicy },
      circuitBreaker: { ...this.circuitBreaker },
      consecutiveFailures: this.consecutiveFailures,
      lastFailureAt: this.lastFailureAt,
      lastError: this.lastError,
      lastFailure: this.lastFailure ? { ...this.lastFailure } : undefined,
    };
  }

  resetHealth(): void {
    this.consecutiveFailures = 0;
    this.lastFailureAt = undefined;
    this.lastError = undefined;
    this.lastFailure = undefined;
    this.state = "closed";
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

    this.refreshCircuitBreakerState();
    if (this.state === "open") {
      throw this.buildOpenCircuitError();
    }

    const maxAttempts = this.state === "half_open" ? 1 : this.retryPolicy.maxRetries + 1;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt += 1;

      try {
        const plannedFailure = this.plannedFailures.shift();
        if (plannedFailure) {
          throw new Error(plannedFailure);
        }

        const result = operation();
        this.consecutiveFailures = 0;
        this.state = "closed";

        if (input.idempotencyKey) {
          this.processedResults.set(input.idempotencyKey, this.cloneResult(result));
        }
        this.externalReferences.add(result.externalReference);

        return this.cloneResult(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failedAt = Date.now();
        this.consecutiveFailures += 1;
        this.lastFailureAt = failedAt;
        this.lastError = message;
        this.lastFailure = {
          attempt,
          failedAt,
          message,
          settlementId: input.settlementId,
          recordId: input.recordId,
          idempotencyKey: input.idempotencyKey,
        };

        this.state =
          this.state === "half_open" || this.consecutiveFailures >= this.circuitBreaker.failureThreshold
            ? "open"
            : "closed";

        if (attempt >= maxAttempts || this.state === "open") {
          throw error instanceof Error ? error : new Error(message);
        }

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

  private refreshCircuitBreakerState(): void {
    if (this.state !== "open" || this.lastFailureAt === undefined) {
      return;
    }

    if (Date.now() - this.lastFailureAt >= this.circuitBreaker.cooldownMs) {
      this.state = "half_open";
    }
  }

  private buildOpenCircuitError(): Error {
    return new Error(
      this.lastError ? `circuit breaker open: ${this.lastError}` : "circuit breaker open",
    );
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

  private normalizeFailureThreshold(value: number | undefined, fallback: number): number {
    if (value === undefined) {
      return fallback;
    }
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`invalid failureThreshold: ${value}`);
    }
    return value;
  }

  private normalizeCooldownMs(value: number | undefined): number {
    if (value === undefined) {
      return DEFAULT_CIRCUIT_BREAKER_COOLDOWN_MS;
    }
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`invalid cooldownMs: ${value}`);
    }
    return Math.floor(value);
  }
}
