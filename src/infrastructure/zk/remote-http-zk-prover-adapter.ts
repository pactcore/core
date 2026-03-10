import { AdapterOperationError, type AdapterDurability, type AdapterHealthReport } from "../../application/adapter-runtime";
import type { ExternalZKProverAdapter } from "../../application/contracts";
import type {
  ExternalZKProveRequest,
  ExternalZKProveResponse,
  ExternalZKVerifyRequest,
  ExternalZKVerifyResponse,
  ZKArtifactDescriptor,
} from "../../domain/zk-bridge";
import { hashZKBridgePayload } from "../../domain/zk-bridge";
import {
  createRemoteZKProverConfigurationError,
  getConfiguredRemoteZKCredentialFields,
  getRequiredRemoteZKCredentialFields,
  type RemoteHttpZKProverAdapterOptions,
  type RemoteZKCredentialType,
} from "./remote-zk-prover-options";

export class RemoteHttpZKProverAdapter implements ExternalZKProverAdapter {
  readonly durability: AdapterDurability = "remote";
  readonly adapterName: string;

  private readonly endpoint?: string;
  private readonly providerId?: string;
  private readonly credentialType: RemoteZKCredentialType;
  private readonly credentials: Record<string, string>;
  private readonly configuredCredentialFields: string[];
  private readonly requiredCredentialFields: string[];
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RemoteHttpZKProverAdapterOptions = {}) {
    this.adapterName = options.adapterName ?? "remote-http-zk-prover";
    this.endpoint = normalizeOptionalString(options.endpoint);
    this.providerId = normalizeOptionalString(options.providerId);
    this.credentialType = options.credentialType ?? "api_key";
    this.credentials = { ...(options.credentials ?? {}) };
    this.configuredCredentialFields = getConfiguredRemoteZKCredentialFields(options);
    this.requiredCredentialFields = getRequiredRemoteZKCredentialFields(options);
    this.timeoutMs = normalizeTimeout(options.timeoutMs);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async loadArtifact(artifact: ZKArtifactDescriptor): Promise<string | Uint8Array> {
    const response = await this.sendRequest("load_artifact", artifact.uri, "GET");
    if (typeof response === "string" || response instanceof Uint8Array) {
      return response;
    }

    throw new AdapterOperationError(`Artifact ${artifact.uri} returned an unsupported payload`, {
      adapter: "zk",
      operation: "load_artifact",
      code: "zk_remote_artifact_payload_invalid",
      retryable: false,
      details: {
        role: artifact.role,
        uri: artifact.uri,
      },
    });
  }

  async prove(request: ExternalZKProveRequest): Promise<ExternalZKProveResponse> {
    const response = await this.sendRequest(this.requireEndpoint(), "prove", "POST", {
      operation: "prove",
      request,
    });
    const body = expectRecord(response, "zk remote prove");

    return {
      commitment: expectString(body.commitment, "zk remote prove commitment"),
      proof: expectString(body.proof, "zk remote prove proof"),
      traceId: optionalString(body.traceId),
      adapterReceiptId: optionalString(body.adapterReceiptId),
    };
  }

  async verify(request: ExternalZKVerifyRequest): Promise<ExternalZKVerifyResponse> {
    const response = await this.sendRequest(this.requireEndpoint(), "verify", "POST", {
      operation: "verify",
      request,
    });
    const body = expectRecord(response, "zk remote verify");

    return {
      verified: expectBoolean(body.verified, "zk remote verify verified"),
      traceId: optionalString(body.traceId),
      adapterReceiptId: optionalString(body.adapterReceiptId),
      details: normalizeDetails(body.details),
    };
  }

  getHealth(): AdapterHealthReport {
    const lastError = createRemoteZKProverConfigurationError({
      endpoint: this.endpoint,
      providerId: this.providerId,
      credentialType: this.credentialType,
      credentials: this.credentials,
      configuredCredentialFields: this.configuredCredentialFields,
      requiredCredentialFields: this.requiredCredentialFields,
    });

    return {
      name: this.adapterName,
      state: lastError ? "degraded" : "healthy",
      checkedAt: Date.now(),
      durable: true,
      durability: this.durability,
      features: {
        externalProver: true,
        remoteHttp: true,
        receiptTraceability: true,
        artifactIntegrity: true,
        endpointConfigured: Boolean(this.endpoint),
        providerConfigured: Boolean(this.providerId),
        providerId: this.providerId ?? "unknown",
        credentialType: this.credentialType,
        configuredCredentialFields: this.configuredCredentialFields.join(",") || "none",
        requiredCredentialFields: this.requiredCredentialFields.join(",") || "none",
        timeoutMs: this.timeoutMs,
      },
      compatibility: {
        compatible: true,
      },
      lastError,
    };
  }

  private requireEndpoint(): string {
    if (!this.endpoint) {
      throw new AdapterOperationError("Remote ZK prover endpoint is required", {
        adapter: "zk",
        operation: "configure_remote_zk_prover",
        code: "zk_remote_endpoint_missing",
        retryable: false,
      });
    }

    return this.endpoint;
  }

  private ensureConfigured(operation: "prove" | "verify"): void {
    const lastError = createRemoteZKProverConfigurationError({
      endpoint: this.endpoint,
      providerId: this.providerId,
      credentialType: this.credentialType,
      credentials: this.credentials,
      configuredCredentialFields: this.configuredCredentialFields,
      requiredCredentialFields: this.requiredCredentialFields,
    });
    if (!lastError) {
      return;
    }

    throw new AdapterOperationError(lastError.message, {
      adapter: lastError.adapter,
      operation,
      code: lastError.code,
      retryable: false,
      details: lastError.details,
      occurredAt: lastError.occurredAt,
    });
  }

  private async sendRequest(
    url: string,
    operation: "prove" | "verify" | "load_artifact",
    method: "GET" | "POST",
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    if (operation === "prove" || operation === "verify") {
      this.ensureConfigured(operation);
    }

    const encodedBody = body ? JSON.stringify(body) : undefined;
    const requestDigest = body ? await hashZKBridgePayload(body) : undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          ...(encodedBody ? { "content-type": "application/json" } : {}),
          "x-pact-zk-operation": operation,
          "x-pact-zk-provider-id": this.providerId ?? "unknown",
          ...(requestDigest ? { "x-pact-zk-request-digest": `sha256:${requestDigest}` } : {}),
          ...this.buildAuthHeaders(),
        },
        body: encodedBody,
        signal: controller.signal,
      });
      const parsedBody = await parseResponseBody(response);

      if (!response.ok) {
        throw new AdapterOperationError(`Remote ZK ${operation} failed with HTTP ${response.status}`, {
          adapter: "zk",
          operation,
          code: "zk_remote_http_status",
          retryable: response.status >= 500,
          details: {
            status: String(response.status),
            url,
          },
        });
      }

      return parsedBody;
    } catch (error) {
      if (error instanceof AdapterOperationError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new AdapterOperationError(`Remote ZK ${operation} timed out after ${this.timeoutMs}ms`, {
          adapter: "zk",
          operation,
          code: "zk_remote_timeout",
          retryable: true,
          details: {
            timeoutMs: String(this.timeoutMs),
            url,
          },
        });
      }

      throw new AdapterOperationError(error instanceof Error ? error.message : `Remote ZK ${operation} request failed`, {
        adapter: "zk",
        operation,
        code: "zk_remote_request_failed",
        retryable: true,
        details: {
          url,
        },
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildAuthHeaders(): Record<string, string> {
    switch (this.credentialType) {
      case "none":
        return {};
      case "api_key":
        return {
          "x-api-key": firstCredentialValue(this.credentials, ["apiKey", "api_key", "key", "token"]),
        };
      case "bearer":
        return {
          authorization: `Bearer ${firstCredentialValue(this.credentials, ["token", "accessToken", "access_token"])}`,
        };
      case "basic": {
        const username = firstCredentialValue(this.credentials, ["username"]);
        const password = firstCredentialValue(this.credentials, ["password"]);
        return {
          authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        };
      }
      case "oauth2":
        return {
          authorization: `Bearer ${firstCredentialValue(this.credentials, ["accessToken", "access_token", "token"])}`,
        };
      case "service_account": {
        const headers: Record<string, string> = {
          authorization: `Bearer ${firstCredentialValue(this.credentials, ["accessToken", "access_token", "token"])}`,
        };
        const clientEmail = firstOptionalCredentialValue(this.credentials, ["clientEmail", "client_email", "email"]);
        const projectId = firstOptionalCredentialValue(this.credentials, ["projectId", "project_id"]);
        const scope = firstOptionalCredentialValue(this.credentials, ["scope"]);
        if (clientEmail) {
          headers["x-service-account-email"] = clientEmail;
        }
        if (projectId) {
          headers["x-service-account-project"] = projectId;
        }
        if (scope) {
          headers["x-service-account-scope"] = scope;
        }
        return headers;
      }
    }
  }
}

function firstCredentialValue(credentials: Record<string, string>, keys: string[]): string {
  const value = firstOptionalCredentialValue(credentials, keys);
  if (!value) {
    throw new AdapterOperationError("Remote ZK credentials are incomplete", {
      adapter: "zk",
      operation: "configure_remote_zk_prover",
      code: "zk_remote_credentials_incomplete",
      retryable: false,
    });
  }

  return value;
}

function firstOptionalCredentialValue(
  credentials: Record<string, string>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = normalizeOptionalString(credentials[key]);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function normalizeDetails(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const normalized: Record<string, string> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof entryValue === "string") {
      normalized[key] = entryValue;
    } else if (typeof entryValue === "number" || typeof entryValue === "boolean") {
      normalized[key] = String(entryValue);
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdapterOperationError(`${label} response must be an object`, {
      adapter: "zk",
      operation: "remote_response_parse",
      code: "zk_remote_response_invalid",
      retryable: false,
    });
  }

  return value as Record<string, unknown>;
}

function expectString(value: unknown, label: string): string {
  const normalized = optionalString(value);
  if (!normalized) {
    throw new AdapterOperationError(`${label} is required`, {
      adapter: "zk",
      operation: "remote_response_parse",
      code: "zk_remote_response_invalid",
      retryable: false,
    });
  }

  return normalized;
}

function expectBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new AdapterOperationError(`${label} is required`, {
      adapter: "zk",
      operation: "remote_response_parse",
      code: "zk_remote_response_invalid",
      retryable: false,
    });
  }

  return value;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    return await response.json();
  }
  if (contentType.includes("application/octet-stream") || contentType.includes("application/wasm")) {
    return new Uint8Array(await response.arrayBuffer());
  }

  const text = await response.text();
  return text.length > 0 ? text : undefined;
}

function normalizeTimeout(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 10_000;
  }

  return Math.floor(value);
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function optionalString(value: unknown): string | undefined {
  return normalizeOptionalString(value);
}
