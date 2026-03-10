import {
  DEFAULT_REMOTE_ZK_REQUIRED_CREDENTIAL_FIELDS,
  type RemoteHttpZKProverAdapterOptions,
  type RemoteZKCredentialType,
} from "./remote-zk-prover-options";

type EnvLike = Record<string, string | undefined>;

interface RemoteZKProverProfileInput {
  endpoint?: string;
  providerId?: string;
  credentialType?: RemoteZKCredentialType;
  configuredCredentialFields?: string[];
  requiredCredentialFields?: string[];
  timeoutMs?: number;
  credentials?: Record<string, string>;
}

export function loadRemoteZKProverAdapterOptionsFromEnv(
  env: EnvLike,
): RemoteHttpZKProverAdapterOptions {
  const jsonKey = "PACT_ZK_REMOTE_PROFILE_JSON";
  const jsonValue = normalizeOptionalString(env[jsonKey]);
  const envProfile = loadEnvRemoteZKProfileInput(env);

  if (jsonValue) {
    return createOptionsFromProfile(mergeRemoteZKProverProfileInputs(parseProfileJson(jsonValue, jsonKey), envProfile));
  }

  return createOptionsFromProfile(envProfile);
}

function createOptionsFromProfile(
  profile: RemoteZKProverProfileInput,
): RemoteHttpZKProverAdapterOptions {
  const credentialType = profile.credentialType ?? "api_key";
  const configuredCredentialFields = new Set<string>([
    ...(profile.configuredCredentialFields ?? []),
    ...Object.keys(profile.credentials ?? {}),
  ]);

  return {
    endpoint: normalizeOptionalString(profile.endpoint),
    providerId: normalizeOptionalString(profile.providerId),
    credentialType,
    credentials: profile.credentials ? { ...profile.credentials } : undefined,
    configuredCredentialFields: [...configuredCredentialFields].sort((left, right) => left.localeCompare(right)),
    requiredCredentialFields: [...(profile.requiredCredentialFields ?? DEFAULT_REMOTE_ZK_REQUIRED_CREDENTIAL_FIELDS[credentialType])],
    timeoutMs: profile.timeoutMs,
  };
}

function loadEnvRemoteZKProfileInput(env: EnvLike): RemoteZKProverProfileInput {
  const credentialTypeValue = normalizeOptionalString(env.PACT_ZK_REMOTE_CREDENTIAL_TYPE);
  const credentialType = credentialTypeValue
    ? parseCredentialType(credentialTypeValue, "PACT_ZK_REMOTE_CREDENTIAL_TYPE")
    : undefined;
  const credentials = loadPrefixedRecord(env, "PACT_ZK_REMOTE_CREDENTIAL_");
  const legacyApiKey = normalizeOptionalString(env.PACT_ZK_REMOTE_API_KEY);
  if (legacyApiKey && !credentials.apiKey) {
    credentials.apiKey = legacyApiKey;
  }

  return {
    endpoint: normalizeOptionalString(env.PACT_ZK_REMOTE_ENDPOINT),
    providerId: normalizeOptionalString(env.PACT_ZK_REMOTE_PROVIDER_ID),
    credentialType,
    requiredCredentialFields: parseFieldList(
      env.PACT_ZK_REMOTE_REQUIRED_CREDENTIAL_FIELDS_JSON,
      "PACT_ZK_REMOTE_REQUIRED_CREDENTIAL_FIELDS_JSON",
    ),
    timeoutMs: parseOptionalInteger(env.PACT_ZK_REMOTE_TIMEOUT_MS, "PACT_ZK_REMOTE_TIMEOUT_MS"),
    credentials,
  };
}

function mergeRemoteZKProverProfileInputs(
  base: RemoteZKProverProfileInput,
  overlay: RemoteZKProverProfileInput,
): RemoteZKProverProfileInput {
  return {
    endpoint: overlay.endpoint ?? base.endpoint,
    providerId: overlay.providerId ?? base.providerId,
    credentialType: overlay.credentialType ?? base.credentialType,
    configuredCredentialFields: [...new Set([
      ...(base.configuredCredentialFields ?? []),
      ...(overlay.configuredCredentialFields ?? []),
    ])].sort((left, right) => left.localeCompare(right)),
    requiredCredentialFields: overlay.requiredCredentialFields ?? base.requiredCredentialFields,
    timeoutMs: overlay.timeoutMs ?? base.timeoutMs,
    credentials: {
      ...(base.credentials ?? {}),
      ...(overlay.credentials ?? {}),
    },
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
    timeoutMs: asNumber(profile.timeoutMs),
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
    .filter(([key, value]) => {
      if (!key.startsWith(prefix) || normalizeOptionalString(value) === undefined) {
        return false;
      }

      const suffix = key.slice(prefix.length);
      return suffix !== "TYPE" && suffix !== "FIELDS_JSON" && suffix !== "JSON";
    })
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

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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

function parseOptionalInteger(value: string | undefined, label: string): number | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }

  return parsed;
}
