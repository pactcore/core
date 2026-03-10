import type {
  SettlementConnectorCircuitBreakerPolicy,
  SettlementConnectorCredentialType,
  SettlementConnectorProfileSummary,
  SettlementConnectorFailure,
  SettlementConnectorHealth,
  SettlementConnectorProviderProfile,
  SettlementConnectorRequest,
  SettlementConnectorResult,
  SettlementConnectorRetryPolicy,
} from "../../application/settlement-connectors";

export interface InMemorySettlementConnectorOptions {
  retryPolicy?: Partial<SettlementConnectorRetryPolicy>;
  circuitBreaker?: Partial<SettlementConnectorCircuitBreakerPolicy>;
  timeoutMs?: number;
  providerProfile?: SettlementConnectorProviderProfile;
}

const DEFAULT_RETRY_POLICY: SettlementConnectorRetryPolicy = {
  maxRetries: 2,
  backoffMs: 10,
  backoffStrategy: "linear",
};

const DEFAULT_CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const CREDENTIAL_KEY_ALIASES: Record<SettlementConnectorCredentialType, Record<string, string>> = {
  none: {},
  api_key: {
    apiKey: "apiKey",
    api_key: "apiKey",
    key: "apiKey",
    token: "apiKey",
  },
  bearer: {
    token: "token",
    accessToken: "token",
    access_token: "token",
  },
  basic: {
    username: "username",
    password: "password",
  },
  oauth2: {
    accessToken: "accessToken",
    access_token: "accessToken",
    token: "accessToken",
  },
  service_account: {
    accessToken: "accessToken",
    access_token: "accessToken",
    token: "accessToken",
    clientEmail: "clientEmail",
    client_email: "clientEmail",
    email: "clientEmail",
    projectId: "projectId",
    project_id: "projectId",
    scope: "scope",
  },
};

export abstract class InMemorySettlementConnectorBase {
  private readonly processedResults = new Map<string, SettlementConnectorResult>();
  private readonly requestFingerprints = new Map<string, string>();
  private readonly inFlightResults = new Map<string, Promise<SettlementConnectorResult>>();
  private readonly externalReferences = new Set<string>();
  private readonly retryPolicy: SettlementConnectorRetryPolicy;
  private readonly circuitBreaker: SettlementConnectorCircuitBreakerPolicy;
  private readonly plannedFailures: string[] = [];
  private readonly plannedDelaysMs: number[] = [];
  private readonly timeoutMs: number;
  private readonly profile?: SettlementConnectorProviderProfile;
  private consecutiveFailures = 0;
  private lastFailureAt?: number;
  private lastError?: string;
  private lastFailure?: SettlementConnectorFailure;
  private state: SettlementConnectorHealth["state"] = "closed";

  protected constructor(options: InMemorySettlementConnectorOptions = {}) {
    this.retryPolicy = {
      maxRetries: this.normalizeRetryCount(options.retryPolicy?.maxRetries),
      backoffMs: this.normalizeBackoffMs(options.retryPolicy?.backoffMs),
      backoffStrategy: this.normalizeBackoffStrategy(options.retryPolicy?.backoffStrategy),
      maxBackoffMs: this.normalizeMaxBackoffMs(options.retryPolicy?.maxBackoffMs),
    };
    this.circuitBreaker = {
      failureThreshold: this.normalizeFailureThreshold(
        options.circuitBreaker?.failureThreshold,
        this.retryPolicy.maxRetries + 1,
      ),
      cooldownMs: this.normalizeCooldownMs(options.circuitBreaker?.cooldownMs),
    };
    this.timeoutMs = this.normalizeTimeoutMs(options.timeoutMs ?? options.providerProfile?.timeoutMs);
    this.profile = options.providerProfile
      ? this.normalizeProviderProfile(options.providerProfile, this.timeoutMs)
      : undefined;
  }

  getHealth(): SettlementConnectorHealth {
    this.refreshCircuitBreakerState();

    return {
      state: this.state,
      retryPolicy: { ...this.retryPolicy },
      circuitBreaker: { ...this.circuitBreaker },
      timeoutMs: this.timeoutMs,
      consecutiveFailures: this.consecutiveFailures,
      lastFailureAt: this.lastFailureAt,
      lastError: this.lastError,
      lastFailure: this.lastFailure ? { ...this.lastFailure } : undefined,
      profile: this.profile ? this.summarizeProfile(this.profile) : undefined,
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

  queueDelay(ms: number, count = 1): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error(`invalid delayMs: ${ms}`);
    }

    const iterations = Number.isInteger(count) && count > 0 ? count : 1;
    const normalizedDelayMs = Math.floor(ms);
    for (let index = 0; index < iterations; index += 1) {
      this.plannedDelaysMs.push(normalizedDelayMs);
    }
  }

  protected async executeWithResilience(
    input: SettlementConnectorRequest,
    operation: () => Promise<SettlementConnectorResult> | SettlementConnectorResult,
  ): Promise<SettlementConnectorResult> {
    const normalizedIdempotencyKey = this.normalizeIdempotencyKey(input.idempotencyKey);
    const request = normalizedIdempotencyKey
      ? {
          ...input,
          idempotencyKey: normalizedIdempotencyKey,
        }
      : input;

    if (normalizedIdempotencyKey) {
      const requestFingerprint = this.createRequestFingerprint(request);
      const existingFingerprint = this.requestFingerprints.get(normalizedIdempotencyKey);
      if (existingFingerprint && existingFingerprint !== requestFingerprint) {
        throw new Error(
          `connector idempotency key reuse with different request: ${normalizedIdempotencyKey}`,
        );
      }
      this.requestFingerprints.set(normalizedIdempotencyKey, requestFingerprint);
    }

    const existingResult = normalizedIdempotencyKey
      ? this.processedResults.get(normalizedIdempotencyKey)
      : undefined;
    if (existingResult) {
      return this.cloneResult(existingResult);
    }

    const existingInFlight = normalizedIdempotencyKey
      ? this.inFlightResults.get(normalizedIdempotencyKey)
      : undefined;
    if (existingInFlight) {
      return this.cloneResult(await existingInFlight);
    }

    this.refreshCircuitBreakerState();
    if (this.state === "open") {
      throw this.buildOpenCircuitError();
    }

    const execution = this.runWithResilience(request, operation);

    if (normalizedIdempotencyKey) {
      this.inFlightResults.set(normalizedIdempotencyKey, execution);
    }

    try {
      const result = await execution;
      if (normalizedIdempotencyKey) {
        this.processedResults.set(normalizedIdempotencyKey, this.cloneResult(result));
      }
      this.externalReferences.add(result.externalReference);
      return this.cloneResult(result);
    } finally {
      if (normalizedIdempotencyKey) {
        this.inFlightResults.delete(normalizedIdempotencyKey);
      }
    }
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

  private async runWithResilience(
    input: SettlementConnectorRequest,
    operation: () => Promise<SettlementConnectorResult> | SettlementConnectorResult,
  ): Promise<SettlementConnectorResult> {
    const maxAttempts = this.state === "half_open" ? 1 : this.retryPolicy.maxRetries + 1;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt += 1;

      try {
        const plannedDelayMs = this.plannedDelaysMs.shift();
        if (plannedDelayMs && plannedDelayMs > 0) {
          if (plannedDelayMs >= this.timeoutMs) {
            await this.sleep(this.timeoutMs);
            throw new Error(`connector attempt timed out after ${this.timeoutMs}ms`);
          }

          await this.sleep(plannedDelayMs);
        }

        const result = await this.withTimeout(async () => {
          const plannedFailure = this.plannedFailures.shift();
          if (plannedFailure) {
            throw new Error(plannedFailure);
          }

          return await operation();
        });

        this.consecutiveFailures = 0;
        this.state = "closed";
        return result;
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

        await this.sleep(this.calculateBackoffMs(attempt));
      }
    }

    throw new Error("connector execution failed");
  }

  private async withTimeout<T>(operation: () => Promise<T>): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      return await new Promise<T>((resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`connector attempt timed out after ${this.timeoutMs}ms`));
        }, this.timeoutMs);

        void operation().then(resolve).catch(reject);
      });
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  protected getTimeoutMs(): number {
    return this.timeoutMs;
  }

  protected getProviderProfile(): SettlementConnectorProviderProfile | undefined {
    if (!this.profile) {
      return undefined;
    }

    return {
      ...this.profile,
      credentialSchema: {
        ...this.profile.credentialSchema,
        fields: this.profile.credentialSchema.fields.map((field) => ({ ...field })),
      },
      credentials: { ...this.profile.credentials },
      metadata: this.profile.metadata ? { ...this.profile.metadata } : undefined,
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

  private normalizeBackoffStrategy(
    value: SettlementConnectorRetryPolicy["backoffStrategy"] | undefined,
  ): NonNullable<SettlementConnectorRetryPolicy["backoffStrategy"]> {
    if (value === undefined) {
      return DEFAULT_RETRY_POLICY.backoffStrategy ?? "linear";
    }

    if (value !== "linear" && value !== "exponential") {
      throw new Error(`invalid backoffStrategy: ${String(value)}`);
    }

    return value;
  }

  private normalizeMaxBackoffMs(value: number | undefined): number | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`invalid maxBackoffMs: ${value}`);
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

  private normalizeTimeoutMs(value: number | undefined): number {
    if (value === undefined) {
      return DEFAULT_TIMEOUT_MS;
    }
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`invalid timeoutMs: ${value}`);
    }
    return Math.floor(value);
  }

  private normalizeProviderProfile(
    profile: SettlementConnectorProviderProfile,
    defaultTimeoutMs: number,
  ): SettlementConnectorProviderProfile {
    const id = this.normalizeRequiredString(profile.id, "providerProfile.id");
    const providerId = this.normalizeRequiredString(profile.providerId, "providerProfile.providerId");
    const displayName = this.normalizeOptionalString(profile.displayName, "providerProfile.displayName");
    const endpoint = this.normalizeOptionalString(profile.endpoint, "providerProfile.endpoint");

    const credentialType = profile.credentialSchema?.type;
    if (
      credentialType !== "none" &&
      credentialType !== "api_key" &&
      credentialType !== "bearer" &&
      credentialType !== "basic" &&
      credentialType !== "oauth2" &&
      credentialType !== "service_account"
    ) {
      throw new Error(`invalid providerProfile.credentialSchema.type: ${String(credentialType)}`);
    }

    const credentialFields = profile.credentialSchema.fields;
    if (!Array.isArray(credentialFields)) {
      throw new Error("providerProfile.credentialSchema.fields must be an array");
    }

    const normalizedFields = credentialFields.map((field, index) => ({
      key: canonicalizeCredentialKey(
        this.normalizeRequiredString(
          field?.key,
          `providerProfile.credentialSchema.fields[${index}].key`,
        ),
        credentialType,
      ),
      required: field?.required !== false,
      secret: field?.secret === true,
    }));

    const uniqueFieldKeys = new Set(normalizedFields.map((field) => field.key));
    if (uniqueFieldKeys.size !== normalizedFields.length) {
      throw new Error("providerProfile.credentialSchema.fields contains duplicate keys");
    }

    const credentials = this.normalizeCredentials(profile.credentials, credentialType);
    for (const field of normalizedFields) {
      if (field.required && credentials[field.key] === undefined) {
        throw new Error(`missing provider credential field: ${field.key}`);
      }
    }

    for (const key of Object.keys(credentials)) {
      if (!uniqueFieldKeys.has(key)) {
        throw new Error(`unsupported provider credential field: ${key}`);
      }
    }

    const metadata = this.normalizeMetadata(profile.metadata);

    return {
      id,
      providerId,
      displayName,
      endpoint,
      timeoutMs: this.normalizeTimeoutMs(profile.timeoutMs ?? defaultTimeoutMs),
      credentialSchema: {
        type: credentialType,
        fields: normalizedFields,
      },
      credentials,
      metadata,
    };
  }

  private summarizeProfile(profile: SettlementConnectorProviderProfile): SettlementConnectorProfileSummary {
    return {
      profileId: profile.id,
      providerId: profile.providerId,
      displayName: profile.displayName,
      endpoint: profile.endpoint,
      credentialType: profile.credentialSchema.type,
      requiredCredentialFields: profile.credentialSchema.fields
        .filter((field) => field.required !== false)
        .map((field) => field.key)
        .sort((left, right) => left.localeCompare(right)),
      configuredCredentialFields: Object.keys(profile.credentials).sort((left, right) =>
        left.localeCompare(right),
      ),
    };
  }

  private normalizeCredentials(
    value: Record<string, string> | undefined,
    credentialType: SettlementConnectorCredentialType,
  ): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("providerProfile.credentials must be an object");
    }

    const entries = Object.entries(value).map(([key, credentialValue]) => {
      const normalizedKey = this.normalizeRequiredString(key, "providerProfile.credentials.key");
      return [
        canonicalizeCredentialKey(normalizedKey, credentialType),
        this.normalizeRequiredString(credentialValue, `providerProfile.credentials.${key}`),
      ] as const;
    });

    const normalized = new Map<string, string>();
    for (const [key, credentialValue] of entries) {
      const existingValue = normalized.get(key);
      if (existingValue !== undefined && existingValue !== credentialValue) {
        throw new Error(`duplicate provider credential field: ${key}`);
      }
      normalized.set(key, credentialValue);
    }

    return Object.fromEntries(normalized.entries());
  }

  private normalizeMetadata(
    value: Record<string, string> | undefined,
  ): Record<string, string> | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new Error("providerProfile.metadata must be an object");
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, metadataValue]) => [
        this.normalizeRequiredString(key, "providerProfile.metadata.key"),
        this.normalizeRequiredString(metadataValue, `providerProfile.metadata.${key}`),
      ]),
    );
  }

  private normalizeRequiredString(value: string | undefined, fieldName: string): string {
    if (typeof value !== "string") {
      throw new Error(`${fieldName} is required`);
    }

    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(`${fieldName} is required`);
    }

    return trimmed;
  }

  private normalizeOptionalString(value: string | undefined, fieldName: string): string | undefined {
    if (value === undefined) {
      return undefined;
    }

    return this.normalizeRequiredString(value, fieldName);
  }

  private normalizeIdempotencyKey(value: string | undefined): string | undefined {
    if (value === undefined) {
      return undefined;
    }

    return this.normalizeRequiredString(value, "connector idempotencyKey");
  }

  private createRequestFingerprint(input: SettlementConnectorRequest): string {
    return JSON.stringify({
      settlementId: input.settlementId,
      recordId: input.recordId,
      legId: input.legId,
      assetId: input.assetId,
      payerId: input.payerId,
      payeeId: input.payeeId,
      amount: input.amount,
      unit: input.unit,
    });
  }

  private calculateBackoffMs(attempt: number): number {
    const baseDelay = this.retryPolicy.backoffMs;
    const computedDelay =
      this.retryPolicy.backoffStrategy === "exponential"
        ? baseDelay * 2 ** Math.max(0, attempt - 1)
        : baseDelay * attempt;

    const maxBackoffMs = this.retryPolicy.maxBackoffMs;
    if (maxBackoffMs === undefined) {
      return computedDelay;
    }

    return Math.min(computedDelay, maxBackoffMs);
  }
}

function canonicalizeCredentialKey(
  key: string,
  credentialType: SettlementConnectorCredentialType,
): string {
  return CREDENTIAL_KEY_ALIASES[credentialType][key] ?? key;
}
