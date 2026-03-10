import type { AdapterDurability, AdapterHealthState } from "../../application/adapter-runtime";
import {
  normalizeManagedBackendConfiguredCredentialFields,
  normalizeManagedBackendCredentialKey,
  summarizeManagedBackendProfile,
  type ManagedBackendCapability,
  type ManagedBackendDomain,
  type ManagedBackendHealthReport,
  type ManagedBackendProfile,
} from "../../application/managed-backends";

export const REMOTE_MANAGED_BACKEND_DURABILITY: AdapterDurability = "remote";

export function cloneManagedBackendProfile(profile: ManagedBackendProfile): ManagedBackendProfile {
  const credentialType = profile.credentialSchema?.type ?? "none";

  return {
    ...profile,
    credentialSchema: profile.credentialSchema
      ? {
          ...profile.credentialSchema,
          fields: profile.credentialSchema.fields.map((field) => ({
            ...field,
            key: normalizeManagedBackendCredentialKey(field.key, credentialType),
          })),
        }
      : undefined,
    configuredCredentialFields: normalizeManagedBackendConfiguredCredentialFields(
      profile.configuredCredentialFields,
      credentialType,
    ),
    metadata: profile.metadata ? { ...profile.metadata } : undefined,
  };
}

export function createRemoteManagedBackendHealth(input: {
  domain: ManagedBackendDomain;
  capability: ManagedBackendCapability;
  profile: ManagedBackendProfile;
  features: Record<string, boolean | number | string>;
  missingFieldsOperation: string;
  name?: string;
}): ManagedBackendHealthReport {
  const credentialType = input.profile.credentialSchema?.type ?? "none";
  const requiredFields = (input.profile.credentialSchema?.fields ?? [])
    .filter((field) => field.required)
    .map((field) => normalizeManagedBackendCredentialKey(field.key, credentialType));
  const configuredFields = new Set(
    normalizeManagedBackendConfiguredCredentialFields(input.profile.configuredCredentialFields, credentialType),
  );
  const missingFields = requiredFields.filter((field) => !configuredFields.has(field));
  const state: AdapterHealthState = input.profile.endpoint && missingFields.length === 0
    ? "healthy"
    : "degraded";
  const now = Date.now();
  const lastError = !input.profile.endpoint
    ? {
        adapter: input.domain,
        operation: `configure_remote_${input.capability}`,
        code: "managed_backend_endpoint_missing",
        message: "Managed backend endpoint is required",
        retryable: false,
        occurredAt: now,
      }
    : missingFields.length > 0
      ? {
          adapter: input.domain,
          operation: input.missingFieldsOperation,
          code: "managed_backend_credentials_incomplete",
          message: `Missing credential fields: ${missingFields.join(", ")}`,
          retryable: false,
          occurredAt: now,
          details: {
            missingFields: missingFields.join(","),
          },
        }
      : undefined;

  return {
    name: input.name ?? `${input.domain}-remote-${input.capability}-backend`,
    domain: input.domain,
    capability: input.capability,
    mode: "remote",
    state,
    checkedAt: now,
    durable: true,
    durability: REMOTE_MANAGED_BACKEND_DURABILITY,
    features: {
      ...input.features,
      skeleton: true,
    },
    profile: summarizeManagedBackendProfile(input.profile),
    lastError,
  };
}
