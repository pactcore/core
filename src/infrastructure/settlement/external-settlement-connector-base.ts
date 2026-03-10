import type {
  SettlementConnectorKind,
  SettlementConnectorOperation,
  SettlementConnectorProviderProfile,
  SettlementConnectorRequest,
  SettlementConnectorResult,
  SettlementConnectorTransport,
  SettlementConnectorTransportRequest,
  SettlementConnectorTransportResponse,
} from "../../application/settlement-connectors";
import {
  InMemorySettlementConnectorBase,
  type InMemorySettlementConnectorOptions,
} from "./in-memory-settlement-connector-base";

export interface ExternalSettlementConnectorOptions extends InMemorySettlementConnectorOptions {
  transport: SettlementConnectorTransport;
  providerProfile: SettlementConnectorProviderProfile;
  connector: SettlementConnectorKind;
  operation: SettlementConnectorOperation;
}

export abstract class ExternalSettlementConnectorBase extends InMemorySettlementConnectorBase {
  private readonly transport: SettlementConnectorTransport;
  private readonly connector: SettlementConnectorKind;
  private readonly operation: SettlementConnectorOperation;

  protected constructor(options: ExternalSettlementConnectorOptions) {
    super(options);
    this.transport = options.transport;
    this.connector = options.connector;
    this.operation = options.operation;
  }

  protected async executeExternalSettlement(
    input: SettlementConnectorRequest,
    connectorPayload: Record<string, string | number | boolean | undefined>,
  ): Promise<SettlementConnectorResult> {
    return this.executeWithResilience(input, async () => {
      const profile = this.requireProviderProfile();
      if (!profile.endpoint) {
        throw new Error("providerProfile.endpoint is required for external settlement connectors");
      }

      const request: SettlementConnectorTransportRequest = {
        connector: this.connector,
        operation: this.operation,
        method: "POST",
        url: profile.endpoint,
        headers: {
          "content-type": "application/json",
          "x-pact-provider-id": profile.providerId,
          "x-pact-provider-profile": profile.id,
          ...this.buildAuthHeaders(profile),
        },
        body: JSON.stringify({
          settlementId: input.settlementId,
          recordId: input.recordId,
          legId: input.legId,
          assetId: input.assetId,
          payerId: input.payerId,
          payeeId: input.payeeId,
          amount: input.amount,
          unit: input.unit,
          idempotencyKey: input.idempotencyKey,
          connector: this.connector,
          operation: this.operation,
          providerId: profile.providerId,
          profileId: profile.id,
          profileMetadata: profile.metadata,
          connectorPayload,
        }),
        timeoutMs: this.getTimeoutMs(),
      };
      const response = await this.transport.send(request);
      return this.mapTransportResponse(input, profile, response);
    });
  }

  private requireProviderProfile(): SettlementConnectorProviderProfile {
    const profile = this.getProviderProfile();
    if (!profile) {
      throw new Error("providerProfile is required for external settlement connectors");
    }
    return profile;
  }

  private buildAuthHeaders(profile: SettlementConnectorProviderProfile): Record<string, string> {
    const credentials = profile.credentials;

    switch (profile.credentialSchema.type) {
      case "none":
        return {};
      case "api_key": {
        const apiKey =
          credentials.apiKey ?? credentials.api_key ?? credentials.key ?? credentials.token ?? firstCredential(credentials);
        return {
          "x-api-key": apiKey,
        };
      }
      case "bearer": {
        const token = credentials.token ?? credentials.accessToken ?? credentials.access_token;
        if (!token) {
          throw new Error("bearer provider profile requires token or accessToken credentials");
        }
        return {
          authorization: `Bearer ${token}`,
        };
      }
      case "basic": {
        const username = credentials.username;
        const password = credentials.password;
        if (!username || !password) {
          throw new Error("basic provider profile requires username and password credentials");
        }
        return {
          authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        };
      }
      case "oauth2": {
        const accessToken = credentials.accessToken ?? credentials.access_token ?? credentials.token;
        if (!accessToken) {
          throw new Error("oauth2 provider profile requires accessToken or token credentials");
        }
        return {
          authorization: `Bearer ${accessToken}`,
        };
      }
      case "service_account": {
        const headers: Record<string, string> = {};
        const token = credentials.accessToken ?? credentials.access_token ?? credentials.token;
        if (token) {
          headers.authorization = `Bearer ${token}`;
        }
        if (credentials.clientEmail ?? credentials.client_email ?? credentials.email) {
          headers["x-service-account-email"] =
            credentials.clientEmail ?? credentials.client_email ?? credentials.email ?? "";
        }
        if (credentials.projectId ?? credentials.project_id) {
          headers["x-service-account-project"] =
            credentials.projectId ?? credentials.project_id ?? "";
        }
        if (credentials.scope) {
          headers["x-service-account-scope"] = credentials.scope;
        }
        return headers;
      }
    }
  }

  private mapTransportResponse(
    input: SettlementConnectorRequest,
    profile: SettlementConnectorProviderProfile,
    response: SettlementConnectorTransportResponse,
  ): SettlementConnectorResult {
    if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
      throw new Error(`external settlement transport failed with HTTP ${response.status}`);
    }

    const body = isRecord(response.body) ? response.body : undefined;
    const metadata = {
      providerId: profile.providerId,
      profileId: profile.id,
      connector: this.connector,
      operation: this.operation,
      httpStatus: String(response.status),
      ...normalizeMetadataRecord(body?.metadata),
    };

    return {
      status: "applied",
      externalReference:
        normalizeOptionalString(body?.externalReference) ??
        normalizeOptionalString(response.headers?.["x-external-reference"]) ??
        `${this.connector}-${input.recordId}`,
      processedAt: normalizeOptionalFiniteNumber(body?.processedAt) ?? Date.now(),
      metadata,
    };
  }
}

function firstCredential(credentials: Record<string, string>): string {
  const value = Object.values(credentials)[0];
  if (!value) {
    throw new Error("provider profile is missing credential values");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeMetadataRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const normalized: Record<string, string> = {};

  for (const [key, entryValue] of Object.entries(value)) {
    const normalizedValue = normalizeMetadataValue(entryValue);
    if (normalizedValue !== undefined) {
      normalized[key] = normalizedValue;
    }
  }

  return normalized;
}

function normalizeMetadataValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return normalizeOptionalString(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : undefined;
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.floor(value);
}
