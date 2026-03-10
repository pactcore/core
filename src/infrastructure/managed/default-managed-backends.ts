import type {
  ManagedBackendCapability,
  ManagedBackendCredentialFieldSchema,
  ManagedBackendCredentialSchema,
  ManagedBackendCredentialType,
  ManagedBackendDomain,
  ManagedBackendInventory,
  ManagedBackendProfile,
  ManagedBackendSuite,
} from "../../application/managed-backends";
import {
  normalizeManagedBackendConfiguredCredentialFields,
  normalizeManagedBackendCredentialKey,
} from "../../application/managed-backends";
import { RemoteHttpManagedObservabilityAdapterSkeleton } from "./remote-http-managed-observability-adapter-skeleton";
import { RemoteHttpManagedQueueAdapterSkeleton } from "./remote-http-managed-queue-adapter-skeleton";
import { RemoteHttpManagedStoreAdapterSkeleton } from "./remote-http-managed-store-adapter-skeleton";

type EnvLike = Record<string, string | undefined>;

interface ManagedBackendProfileLoaderOptions {
  envPrefix: string;
  defaultBackendId: string;
  defaultProviderId: string;
  defaultDisplayName: string;
}

const DEFAULT_CREDENTIAL_FIELDS: Record<
  ManagedBackendCredentialType,
  ManagedBackendCredentialFieldSchema[]
> = {
  none: [],
  api_key: [{ key: "apiKey", required: true, secret: true }],
  bearer: [{ key: "token", required: true, secret: true }],
  oauth2: [{ key: "accessToken", required: true, secret: true }],
  service_account: [
    { key: "accessToken", required: true, secret: true },
    { key: "clientEmail", required: false },
    { key: "projectId", required: false },
    { key: "scope", required: false },
  ],
};

export function createManagedBackendInventoryFromEnv(env: EnvLike): ManagedBackendInventory {
  return {
    data: loadManagedBackendSuiteFromEnv(env, "data"),
    compute: loadManagedBackendSuiteFromEnv(env, "compute"),
    dev: loadManagedBackendSuiteFromEnv(env, "dev"),
  };
}

function loadManagedBackendSuiteFromEnv(
  env: EnvLike,
  domain: ManagedBackendDomain,
): Partial<ManagedBackendSuite> | undefined {
  const queue = loadManagedBackendAdapterFromEnv(env, domain, "queue");
  const store = loadManagedBackendAdapterFromEnv(env, domain, "store");
  const observability = loadManagedBackendAdapterFromEnv(env, domain, "observability");

  if (!queue && !store && !observability) {
    return undefined;
  }

  return {
    queue,
    store,
    observability,
  };
}

function loadManagedBackendAdapterFromEnv(
  env: EnvLike,
  domain: ManagedBackendDomain,
  capability: ManagedBackendCapability,
) {
  const prefix = `PACT_${domain.toUpperCase()}_${capability.toUpperCase()}_BACKEND`;
  const profile = loadManagedBackendProfileFromEnv(env, {
    envPrefix: prefix,
    defaultBackendId: `${domain}-${capability}-backend`,
    defaultProviderId: `${domain}-${capability}`,
    defaultDisplayName: `${capitalize(domain)} ${capability} backend`,
  });

  if (!profile) {
    return undefined;
  }

  if (capability === "queue") {
    return new RemoteHttpManagedQueueAdapterSkeleton({ domain, profile });
  }
  if (capability === "store") {
    return new RemoteHttpManagedStoreAdapterSkeleton({ domain, profile });
  }
  return new RemoteHttpManagedObservabilityAdapterSkeleton({ domain, profile });
}

function loadManagedBackendProfileFromEnv(
  env: EnvLike,
  options: ManagedBackendProfileLoaderOptions,
): ManagedBackendProfile | undefined {
  const jsonKey = `${options.envPrefix}_PROFILE_JSON`;
  const jsonValue = normalizeOptionalString(env[jsonKey]);
  const envProfile = loadManagedBackendProfileInputFromEnv(env, options.envPrefix);

  if (jsonValue) {
    return createManagedBackendProfile(
      mergeManagedBackendProfileInputs(parseProfileJson(jsonValue, jsonKey), envProfile.input),
      options,
    );
  }

  if (!envProfile.hasExplicitValues) {
    return undefined;
  }

  return createManagedBackendProfile(envProfile.input, options);
}

function createManagedBackendCredentialSchema(
  credentialType: ManagedBackendCredentialType,
  fields?: ManagedBackendCredentialFieldSchema[],
): ManagedBackendCredentialSchema {
  return {
    type: credentialType,
    fields: (fields ?? DEFAULT_CREDENTIAL_FIELDS[credentialType]).map((field) => ({ ...field })),
  };
}

function loadManagedBackendProfileInputFromEnv(
  env: EnvLike,
  envPrefix: string,
): {
  hasExplicitValues: boolean;
  input: Partial<ManagedBackendProfile> & {
    credentialType?: ManagedBackendCredentialType;
    credentialSchema?: Partial<ManagedBackendCredentialSchema>;
  };
} {
  const endpoint = normalizeOptionalString(env[`${envPrefix}_ENDPOINT`]);
  const providerId = normalizeOptionalString(env[`${envPrefix}_PROVIDER_ID`]);
  const backendId = normalizeOptionalString(env[`${envPrefix}_BACKEND_ID`]);
  const displayName = normalizeOptionalString(env[`${envPrefix}_DISPLAY_NAME`]);
  const timeoutMs = parseOptionalInteger(env[`${envPrefix}_TIMEOUT_MS`], `${envPrefix}_TIMEOUT_MS`);
  const credentialTypeValue = normalizeOptionalString(env[`${envPrefix}_CREDENTIAL_TYPE`]);
  const credentialType = credentialTypeValue
    ? parseCredentialType(credentialTypeValue, `${envPrefix}_CREDENTIAL_TYPE`)
    : undefined;
  const credentials = loadPrefixedRecord(env, `${envPrefix}_CREDENTIAL_`);
  const metadata = loadPrefixedRecord(env, `${envPrefix}_METADATA_`);
  const fieldSchemaJson = normalizeOptionalString(env[`${envPrefix}_CREDENTIAL_FIELDS_JSON`]);
  const credentialFields = fieldSchemaJson
    ? parseCredentialFields(fieldSchemaJson, `${envPrefix}_CREDENTIAL_FIELDS_JSON`)
    : undefined;

  return {
    hasExplicitValues:
      endpoint !== undefined ||
      providerId !== undefined ||
      backendId !== undefined ||
      displayName !== undefined ||
      timeoutMs !== undefined ||
      credentialType !== undefined ||
      credentialFields !== undefined ||
      Object.keys(credentials).length > 0 ||
      Object.keys(metadata).length > 0,
    input: {
      backendId,
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
      configuredCredentialFields: Object.keys(credentials),
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    },
  };
}

function createManagedBackendProfile(
  input: Partial<ManagedBackendProfile> & {
    credentialType?: ManagedBackendCredentialType;
    credentialSchema?: Partial<ManagedBackendCredentialSchema>;
  },
  defaults: Pick<ManagedBackendProfileLoaderOptions, "defaultBackendId" | "defaultProviderId" | "defaultDisplayName">,
): ManagedBackendProfile {
  const credentialType = input.credentialSchema?.type ?? input.credentialType ?? "none";
  const normalizedCredentialFields = (input.credentialSchema?.fields ?? DEFAULT_CREDENTIAL_FIELDS[credentialType])
    .map((field) => ({
      ...field,
      key: normalizeManagedBackendCredentialKey(field.key, credentialType),
    }));

  return {
    backendId: normalizeRequiredString(input.backendId ?? defaults.defaultBackendId, "managedBackend.backendId"),
    providerId: normalizeRequiredString(input.providerId ?? defaults.defaultProviderId, "managedBackend.providerId"),
    displayName: normalizeOptionalString(input.displayName ?? defaults.defaultDisplayName),
    endpoint: normalizeOptionalString(input.endpoint),
    timeoutMs: input.timeoutMs,
    credentialSchema: createManagedBackendCredentialSchema(credentialType, normalizedCredentialFields),
    configuredCredentialFields: normalizeManagedBackendConfiguredCredentialFields(
      input.configuredCredentialFields,
      credentialType,
    ),
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };
}

function mergeManagedBackendProfileInputs(
  base: Partial<ManagedBackendProfile> & {
    credentialType?: ManagedBackendCredentialType;
    credentialSchema?: Partial<ManagedBackendCredentialSchema>;
  },
  overlay: Partial<ManagedBackendProfile> & {
    credentialType?: ManagedBackendCredentialType;
    credentialSchema?: Partial<ManagedBackendCredentialSchema>;
  },
): Partial<ManagedBackendProfile> & {
  credentialType?: ManagedBackendCredentialType;
  credentialSchema?: Partial<ManagedBackendCredentialSchema>;
} {
  const credentialType =
    overlay.credentialSchema?.type ??
    overlay.credentialType ??
    base.credentialSchema?.type ??
    base.credentialType;
  const credentialFields = overlay.credentialSchema?.fields ?? base.credentialSchema?.fields;

  return {
    backendId: overlay.backendId ?? base.backendId,
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
    configuredCredentialFields: [...new Set([
      ...(base.configuredCredentialFields ?? []),
      ...(overlay.configuredCredentialFields ?? []),
    ])].sort((left, right) => left.localeCompare(right)),
    metadata: mergeOptionalStringRecords(base.metadata, overlay.metadata),
  };
}

function parseProfileJson(value: string, label: string): Partial<ManagedBackendProfile> & {
  credentialType?: ManagedBackendCredentialType;
  credentialSchema?: Partial<ManagedBackendCredentialSchema>;
} {
  const parsed = parseJsonValue(value, label);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must describe an object profile`);
  }

  const profile = parsed as Record<string, unknown>;
  return {
    backendId: normalizeOptionalString(asString(profile.backendId)),
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
    configuredCredentialFields: Array.isArray(profile.configuredCredentialFields)
      ? profile.configuredCredentialFields.map((field, index) =>
          normalizeRequiredString(asString(field), `${label}.configuredCredentialFields[${index}]`))
      : undefined,
    metadata: parseOptionalStringRecord(profile.metadata, `${label}.metadata`),
  };
}

function parseCredentialSchema(
  value: object,
  label: string,
): Partial<ManagedBackendCredentialSchema> {
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
): ManagedBackendCredentialFieldSchema[] {
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

function parseCredentialType(value: string, label: string): ManagedBackendCredentialType {
  if (
    value === "none" ||
    value === "api_key" ||
    value === "bearer" ||
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

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
