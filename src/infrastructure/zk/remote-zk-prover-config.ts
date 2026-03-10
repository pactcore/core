import type { RemoteHttpZKProverAdapterSkeletonOptions } from "./remote-http-zk-prover-adapter-skeleton";

type EnvLike = Record<string, string | undefined>;

type RemoteZKCredentialType =
  | "none"
  | "api_key"
  | "bearer"
  | "basic"
  | "oauth2"
  | "service_account";

interface RemoteZKProverProfileInput {
  endpoint?: string;
  providerId?: string;
  credentialType?: RemoteZKCredentialType;
  configuredCredentialFields?: string[];
  requiredCredentialFields?: string[];
  credentials?: Record<string, string>;
}

const DEFAULT_REQUIRED_CREDENTIAL_FIELDS: Record<RemoteZKCredentialType, string[]> = {
  none: [],
  api_key: ["apiKey"],
  bearer: ["token"],
  basic: ["username", "password"],
  oauth2: ["accessToken"],
  service_account: ["accessToken"],
};

export function loadRemoteZKProverAdapterOptionsFromEnv(
  env: EnvLike,
): RemoteHttpZKProverAdapterSkeletonOptions {
  const jsonKey = "PACT_ZK_REMOTE_PROFILE_JSON";
  const jsonValue = normalizeOptionalString(env[jsonKey]);

  if (jsonValue) {
    return createOptionsFromProfile(parseProfileJson(jsonValue, jsonKey));
  }

  const credentialType = parseCredentialType(
    normalizeOptionalString(env.PACT_ZK_REMOTE_CREDENTIAL_TYPE) ?? "api_key",
    "PACT_ZK_REMOTE_CREDENTIAL_TYPE",
  );
  const credentials = loadPrefixedRecord(env, "PACT_ZK_REMOTE_CREDENTIAL_");
  const legacyApiKey = normalizeOptionalString(env.PACT_ZK_REMOTE_API_KEY);
  if (legacyApiKey && !credentials.apiKey) {
    credentials.apiKey = legacyApiKey;
  }

  return {
    endpoint: normalizeOptionalString(env.PACT_ZK_REMOTE_ENDPOINT),
    providerId: normalizeOptionalString(env.PACT_ZK_REMOTE_PROVIDER_ID),
    configuredCredentialFields: Object.keys(credentials).sort((left, right) => left.localeCompare(right)),
    requiredCredentialFields: parseFieldList(
      env.PACT_ZK_REMOTE_REQUIRED_CREDENTIAL_FIELDS_JSON,
      "PACT_ZK_REMOTE_REQUIRED_CREDENTIAL_FIELDS_JSON",
    ) ?? DEFAULT_REQUIRED_CREDENTIAL_FIELDS[credentialType],
  };
}

function createOptionsFromProfile(
  profile: RemoteZKProverProfileInput,
): RemoteHttpZKProverAdapterSkeletonOptions {
  const credentialType = profile.credentialType ?? "api_key";
  const configuredCredentialFields = new Set<string>([
    ...(profile.configuredCredentialFields ?? []),
    ...Object.keys(profile.credentials ?? {}),
  ]);

  return {
    endpoint: normalizeOptionalString(profile.endpoint),
    providerId: normalizeOptionalString(profile.providerId),
    configuredCredentialFields: [...configuredCredentialFields].sort((left, right) => left.localeCompare(right)),
    requiredCredentialFields: [...(profile.requiredCredentialFields ?? DEFAULT_REQUIRED_CREDENTIAL_FIELDS[credentialType])],
  };
}

function parseProfileJson(value: string, label: string): RemoteZKProverProfileInput {
  const parsed = parseJsonValue(value, label);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must describe an object profile`);
  }

  const profile = parsed as Record<string, unknown>;
  return {
    endpoint: normalizeOptionalString(asString(profile.endpoint)),
    providerId: normalizeOptionalString(asString(profile.providerId)),
    credentialType: profile.credentialType
      ? parseCredentialType(String(profile.credentialType), `${label}.credentialType`)
      : undefined,
    configuredCredentialFields: profile.configuredCredentialFields
      ? parseFieldList(profile.configuredCredentialFields, `${label}.configuredCredentialFields`)
      : undefined,
    requiredCredentialFields: profile.requiredCredentialFields
      ? parseFieldList(profile.requiredCredentialFields, `${label}.requiredCredentialFields`)
      : undefined,
    credentials: parseOptionalStringRecord(profile.credentials, `${label}.credentials`),
  };
}

function parseFieldList(value: string | unknown, label: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = typeof value === "string" ? parseJsonValue(value, label) : value;
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be an array`);
  }

  return parsed
    .map((entry, index) => normalizeRequiredString(asString(entry), `${label}[${index}]`))
    .sort((left, right) => left.localeCompare(right));
}

function parseOptionalStringRecord(
  value: unknown,
  label: string,
): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
      normalizeRequiredString(key, `${label}.key`),
      normalizeRequiredString(asString(nestedValue), `${label}.${key}`),
    ]),
  );
}

function loadPrefixedRecord(env: EnvLike, prefix: string): Record<string, string> {
  const entries = Object.entries(env)
    .filter(([key, value]) => key.startsWith(prefix) && normalizeOptionalString(value) !== undefined)
    .map(([key, value]) => [toCamelCase(key.slice(prefix.length)), normalizeRequiredString(value, key)]);

  return Object.fromEntries(entries);
}

function parseCredentialType(value: string, label: string): RemoteZKCredentialType {
  if (
    value === "none" ||
    value === "api_key" ||
    value === "bearer" ||
    value === "basic" ||
    value === "oauth2" ||
    value === "service_account"
  ) {
    return value;
  }

  throw new Error(`${label} has unsupported credential type: ${value}`);
}

function parseJsonValue(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} must be valid JSON`, { cause: error });
  }
}

function toCamelCase(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    throw new Error("Credential field suffix is required");
  }

  return normalized.replace(/_([a-z0-9])/g, (_, token: string) => token.toUpperCase());
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeRequiredString(value: string | undefined, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} is required`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }

  return normalized;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
