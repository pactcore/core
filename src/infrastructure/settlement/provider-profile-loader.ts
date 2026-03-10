import type {
  SettlementConnectorCredentialFieldSchema,
  SettlementConnectorCredentialSchema,
  SettlementConnectorCredentialType,
  SettlementConnectorKind,
  SettlementConnectorProviderProfile,
} from "../../application/settlement-connectors";

type EnvLike = Record<string, string | undefined>;

export interface SettlementConnectorProfileInput {
  id?: string;
  providerId?: string;
  displayName?: string;
  endpoint?: string;
  timeoutMs?: number;
  credentialType?: SettlementConnectorCredentialType;
  credentialSchema?: Partial<SettlementConnectorCredentialSchema>;
  credentials?: Record<string, string>;
  metadata?: Record<string, string>;
}

export interface LoadSettlementConnectorProviderProfileOptions {
  connector: SettlementConnectorKind;
  envPrefix: string;
  defaultProfileId: string;
  defaultProviderId: string;
  defaultDisplayName: string;
}

export interface LoadedSettlementConnectorProviderProfiles {
  llmTokenMetering?: SettlementConnectorProviderProfile;
  cloudCreditBilling?: SettlementConnectorProviderProfile;
  apiQuotaAllocation?: SettlementConnectorProviderProfile;
}

const DEFAULT_CREDENTIAL_FIELDS: Record<
  SettlementConnectorCredentialType,
  SettlementConnectorCredentialFieldSchema[]
> = {
  none: [],
  api_key: [{ key: "apiKey", required: true, secret: true }],
  bearer: [{ key: "token", required: true, secret: true }],
  basic: [
    { key: "username", required: true },
    { key: "password", required: true, secret: true },
  ],
  oauth2: [{ key: "accessToken", required: true, secret: true }],
  service_account: [
    { key: "accessToken", required: true, secret: true },
    { key: "clientEmail", required: false },
    { key: "projectId", required: false },
    { key: "scope", required: false },
  ],
};

export function createSettlementConnectorCredentialSchema(
  credentialType: SettlementConnectorCredentialType,
  fields?: SettlementConnectorCredentialFieldSchema[],
): SettlementConnectorCredentialSchema {
  return {
    type: credentialType,
    fields: (fields ?? DEFAULT_CREDENTIAL_FIELDS[credentialType]).map((field) => ({ ...field })),
  };
}

export function createSettlementConnectorProviderProfile(
  input: SettlementConnectorProfileInput,
  defaults: Pick<
    LoadSettlementConnectorProviderProfileOptions,
    "defaultProfileId" | "defaultProviderId" | "defaultDisplayName"
  >,
): SettlementConnectorProviderProfile {
  const credentialType = input.credentialSchema?.type ?? input.credentialType ?? "none";
  const credentialFields = input.credentialSchema?.fields;

  return {
    id: normalizeRequiredString(input.id ?? defaults.defaultProfileId, "providerProfile.id"),
    providerId: normalizeRequiredString(
      input.providerId ?? defaults.defaultProviderId,
      "providerProfile.providerId",
    ),
    displayName: normalizeOptionalString(input.displayName ?? defaults.defaultDisplayName),
    endpoint: normalizeOptionalString(input.endpoint),
    timeoutMs: input.timeoutMs,
    credentialSchema: createSettlementConnectorCredentialSchema(credentialType, credentialFields),
    credentials: normalizeStringRecord(input.credentials ?? {}),
    metadata: normalizeOptionalRecord(input.metadata),
  };
}

export function loadSettlementConnectorProviderProfileFromEnv(
  env: EnvLike,
  options: LoadSettlementConnectorProviderProfileOptions,
): SettlementConnectorProviderProfile | undefined {
  const jsonKey = `${options.envPrefix}_PROFILE_JSON`;
  const jsonValue = normalizeOptionalString(env[jsonKey]);
  const envProfile = loadEnvProfileInput(env, options.envPrefix);

  if (jsonValue) {
    return createSettlementConnectorProviderProfile(
      mergeSettlementConnectorProfileInputs(parseProfileJson(jsonValue, jsonKey), envProfile.input),
      options,
    );
  }

  if (!envProfile.hasExplicitValues) {
    return undefined;
  }

  return createSettlementConnectorProviderProfile(envProfile.input, options);
}

export function loadSettlementConnectorProviderProfilesFromEnv(
  env: EnvLike,
): LoadedSettlementConnectorProviderProfiles {
  return {
    llmTokenMetering: loadSettlementConnectorProviderProfileFromEnv(env, {
      connector: "llm_token_metering",
      envPrefix: "PACT_LLM_SETTLEMENT",
      defaultProfileId: "llm-default",
      defaultProviderId: "llm",
      defaultDisplayName: "LLM settlement provider",
    }),
    cloudCreditBilling: loadSettlementConnectorProviderProfileFromEnv(env, {
      connector: "cloud_credit_billing",
      envPrefix: "PACT_CLOUD_SETTLEMENT",
      defaultProfileId: "cloud-default",
      defaultProviderId: "cloud",
      defaultDisplayName: "Cloud settlement provider",
    }),
    apiQuotaAllocation: loadSettlementConnectorProviderProfileFromEnv(env, {
      connector: "api_quota_allocation",
      envPrefix: "PACT_API_SETTLEMENT",
      defaultProfileId: "api-default",
      defaultProviderId: "api",
      defaultDisplayName: "API settlement provider",
    }),
  };
}

function loadEnvProfileInput(
  env: EnvLike,
  envPrefix: string,
): {
  hasExplicitValues: boolean;
  input: SettlementConnectorProfileInput;
} {
  const endpoint = normalizeOptionalString(env[`${envPrefix}_ENDPOINT`]);
  const providerId = normalizeOptionalString(env[`${envPrefix}_PROVIDER_ID`]);
  const id = normalizeOptionalString(env[`${envPrefix}_PROFILE_ID`]);
  const displayName = normalizeOptionalString(env[`${envPrefix}_DISPLAY_NAME`]);
  const timeoutMs = parseOptionalInteger(env[`${envPrefix}_TIMEOUT_MS`], `${envPrefix}_TIMEOUT_MS`);
  const credentialTypeValue = normalizeOptionalString(env[`${envPrefix}_CREDENTIAL_TYPE`]);
  const credentialType = credentialTypeValue
    ? parseCredentialType(credentialTypeValue, `${envPrefix}_CREDENTIAL_TYPE`)
    : undefined;
  const credentials = loadPrefixedRecord(env, `${envPrefix}_CREDENTIAL_`);
  const metadata = loadPrefixedRecord(env, `${envPrefix}_METADATA_`);
  const schemaJson = normalizeOptionalString(env[`${envPrefix}_CREDENTIAL_FIELDS_JSON`]);
  const credentialFields = schemaJson
    ? parseCredentialFields(schemaJson, `${envPrefix}_CREDENTIAL_FIELDS_JSON`)
    : undefined;

  return {
    hasExplicitValues:
      endpoint !== undefined ||
      providerId !== undefined ||
      id !== undefined ||
      displayName !== undefined ||
      timeoutMs !== undefined ||
      credentialType !== undefined ||
      credentialFields !== undefined ||
      Object.keys(credentials).length > 0 ||
      Object.keys(metadata).length > 0,
    input: {
      id,
      providerId,
      displayName,
      endpoint,
      timeoutMs,
      credentialType,
      credentialSchema: credentialType || credentialFields
        ? {
            type: credentialType,
            fields: credentialFields,
          }
        : undefined,
      credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    },
  };
}

function mergeSettlementConnectorProfileInputs(
  base: SettlementConnectorProfileInput,
  overlay: SettlementConnectorProfileInput,
): SettlementConnectorProfileInput {
  const credentialType =
    overlay.credentialSchema?.type ??
    overlay.credentialType ??
    base.credentialSchema?.type ??
    base.credentialType;
  const credentialFields = overlay.credentialSchema?.fields ?? base.credentialSchema?.fields;

  return {
    id: overlay.id ?? base.id,
    providerId: overlay.providerId ?? base.providerId,
    displayName: overlay.displayName ?? base.displayName,
    endpoint: overlay.endpoint ?? base.endpoint,
    timeoutMs: overlay.timeoutMs ?? base.timeoutMs,
    credentialType,
    credentialSchema: credentialType || credentialFields
      ? {
          type: credentialType,
          fields: credentialFields,
        }
      : undefined,
    credentials: mergeOptionalStringRecords(base.credentials, overlay.credentials),
    metadata: mergeOptionalStringRecords(base.metadata, overlay.metadata),
  };
}

function parseProfileJson(value: string, label: string): SettlementConnectorProfileInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} must be valid JSON`, { cause: error });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must describe an object profile`);
  }

  const profile = parsed as Record<string, unknown>;
  return {
    id: normalizeOptionalString(asString(profile.id)),
    providerId: normalizeOptionalString(asString(profile.providerId)),
    displayName: normalizeOptionalString(asString(profile.displayName)),
    endpoint: normalizeOptionalString(asString(profile.endpoint)),
    timeoutMs: asNumber(profile.timeoutMs),
    credentialType: profile.credentialType
      ? parseCredentialType(String(profile.credentialType), `${label}.credentialType`)
      : undefined,
    credentialSchema: profile.credentialSchema && typeof profile.credentialSchema === "object"
      ? parseCredentialSchema(profile.credentialSchema, `${label}.credentialSchema`)
      : undefined,
    credentials: parseOptionalStringRecord(profile.credentials, `${label}.credentials`),
    metadata: parseOptionalStringRecord(profile.metadata, `${label}.metadata`),
  };
}

function parseCredentialSchema(
  value: object,
  label: string,
): Partial<SettlementConnectorCredentialSchema> {
  const schema = value as {
    type?: unknown;
    fields?: unknown;
  };

  return {
    type: schema.type ? parseCredentialType(String(schema.type), `${label}.type`) : undefined,
    fields: schema.fields ? parseCredentialFields(schema.fields, `${label}.fields`) : undefined,
  };
}

function parseCredentialFields(
  value: string | unknown,
  label: string,
): SettlementConnectorCredentialFieldSchema[] {
  const parsed = typeof value === "string" ? parseJsonValue(value, label) : value;
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be an array`);
  }

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${label}[${index}] must be an object`);
    }

    const field = entry as Record<string, unknown>;
    return {
      key: normalizeRequiredString(asString(field.key), `${label}[${index}].key`),
      required: field.required === undefined ? true : Boolean(field.required),
      secret: field.secret === true,
    };
  });
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

function mergeOptionalStringRecords(
  base: Record<string, string> | undefined,
  overlay: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!base && !overlay) {
    return undefined;
  }

  return {
    ...(base ?? {}),
    ...(overlay ?? {}),
  };
}

function parseCredentialType(
  value: string,
  label: string,
): SettlementConnectorCredentialType {
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

function parseOptionalInteger(value: string | undefined, label: string): number | undefined {
  const normalized = normalizeOptionalString(value);
  if (normalized === undefined) {
    return undefined;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
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

function normalizeStringRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      normalizeRequiredString(key, "record.key"),
      normalizeRequiredString(nestedValue, `record.${key}`),
    ]),
  );
}

function normalizeOptionalRecord(
  value: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }
  return normalizeStringRecord(value);
}

function parseJsonValue(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} must be valid JSON`, { cause: error });
  }
}

function toCamelCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .filter((segment) => segment.length > 0)
    .map((segment, index) => index === 0 ? segment : `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`)
    .join("");
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
