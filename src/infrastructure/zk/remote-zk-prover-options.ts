import type { AdapterHealthReport } from "../../application/adapter-runtime";

export type RemoteZKCredentialType =
  | "none"
  | "api_key"
  | "bearer"
  | "basic"
  | "oauth2"
  | "service_account";

export interface RemoteHttpZKProverAdapterOptions {
  endpoint?: string;
  adapterName?: string;
  providerId?: string;
  credentialType?: RemoteZKCredentialType;
  credentials?: Record<string, string>;
  configuredCredentialFields?: string[];
  requiredCredentialFields?: string[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export const DEFAULT_REMOTE_ZK_REQUIRED_CREDENTIAL_FIELDS: Record<RemoteZKCredentialType, string[]> = {
  none: [],
  api_key: ["apiKey"],
  bearer: ["token"],
  basic: ["username", "password"],
  oauth2: ["accessToken"],
  service_account: ["accessToken"],
};

export function getConfiguredRemoteZKCredentialFields(
  options: RemoteHttpZKProverAdapterOptions,
): string[] {
  return [...new Set([...(options.configuredCredentialFields ?? []), ...Object.keys(options.credentials ?? {})])]
    .sort((left, right) => left.localeCompare(right));
}

export function getRequiredRemoteZKCredentialFields(
  options: RemoteHttpZKProverAdapterOptions,
): string[] {
  const credentialType = options.credentialType ?? "api_key";
  return [...(options.requiredCredentialFields ?? DEFAULT_REMOTE_ZK_REQUIRED_CREDENTIAL_FIELDS[credentialType])]
    .sort((left, right) => left.localeCompare(right));
}

export function getMissingRemoteZKCredentialFields(
  options: RemoteHttpZKProverAdapterOptions,
): string[] {
  const configuredFields = new Set(getConfiguredRemoteZKCredentialFields(options));
  return getRequiredRemoteZKCredentialFields(options).filter((field) => !configuredFields.has(field));
}

export function isRemoteZKProverAdapterConfigured(
  options: RemoteHttpZKProverAdapterOptions,
): boolean {
  return Boolean(normalizeOptionalString(options.endpoint)) && getMissingRemoteZKCredentialFields(options).length === 0;
}

export function createRemoteZKProverConfigurationError(
  options: RemoteHttpZKProverAdapterOptions,
): AdapterHealthReport["lastError"] {
  const hasEndpoint = Boolean(normalizeOptionalString(options.endpoint));
  const missingFields = getMissingRemoteZKCredentialFields(options);

  if (hasEndpoint && missingFields.length === 0) {
    return undefined;
  }

  if (!hasEndpoint && missingFields.length === 0) {
    return {
      adapter: "zk",
      operation: "configure_remote_zk_prover",
      code: "zk_remote_endpoint_missing",
      message: "Remote ZK prover endpoint is required",
      retryable: false,
      occurredAt: Date.now(),
    };
  }

  if (hasEndpoint) {
    return {
      adapter: "zk",
      operation: "configure_remote_zk_prover",
      code: "zk_remote_credentials_incomplete",
      message: `Missing credential fields: ${missingFields.join(", ")}`,
      retryable: false,
      occurredAt: Date.now(),
      details: {
        missingFields: missingFields.join(","),
      },
    };
  }

  return {
    adapter: "zk",
    operation: "configure_remote_zk_prover",
    code: "zk_remote_configuration_incomplete",
    message: `Remote ZK prover endpoint is required and credential fields are missing: ${missingFields.join(", ")}`,
    retryable: false,
    occurredAt: Date.now(),
    details: {
      missingFields: missingFields.join(","),
      missingEndpoint: "true",
    },
  };
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
