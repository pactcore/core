import {
  aggregateAdapterHealth,
  type AdapterDurability,
  type AdapterHealthReport,
  type AdapterHealthSummary,
} from "./adapter-runtime";

export type ManagedBackendDomain = "data" | "compute" | "dev";
export type ManagedBackendCapability = "queue" | "store" | "observability";
export type ManagedBackendMode = "local" | "remote";
export type ManagedBackendCredentialType =
  | "none"
  | "api_key"
  | "bearer"
  | "oauth2"
  | "service_account";

const MANAGED_BACKEND_CREDENTIAL_KEY_ALIASES: Record<ManagedBackendCredentialType, Record<string, string>> = {
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

export interface ManagedBackendCredentialFieldSchema {
  key: string;
  required?: boolean;
  secret?: boolean;
}

export interface ManagedBackendCredentialSchema {
  type: ManagedBackendCredentialType;
  fields: ManagedBackendCredentialFieldSchema[];
}

export interface ManagedBackendProfile {
  backendId: string;
  providerId: string;
  displayName?: string;
  endpoint?: string;
  timeoutMs?: number;
  credentialSchema?: ManagedBackendCredentialSchema;
  configuredCredentialFields?: string[];
  metadata?: Record<string, string>;
}

export interface ManagedBackendProfileSummary {
  backendId: string;
  providerId: string;
  displayName?: string;
  endpoint?: string;
  timeoutMs?: number;
  credentialType: ManagedBackendCredentialType;
  requiredCredentialFields: string[];
  configuredCredentialFields: string[];
  metadata?: Record<string, string>;
}

export interface ManagedBackendHealthReport extends AdapterHealthReport {
  domain: ManagedBackendDomain;
  capability: ManagedBackendCapability;
  mode: ManagedBackendMode;
  profile?: ManagedBackendProfileSummary;
}

export interface ManagedBackendHealthSummary extends AdapterHealthSummary {
  backends: ManagedBackendHealthReport[];
}

export interface ManagedQueueMessage<TPayload = unknown> {
  id: string;
  topic: string;
  payload: TPayload;
  createdAt: number;
  runAt?: number;
  priority?: number;
  metadata?: Record<string, string>;
}

export interface ManagedQueueReceipt {
  messageId: string;
  backendMessageId: string;
  acceptedAt: number;
  state: "accepted" | "queued" | "scheduled";
  metadata?: Record<string, string>;
}

export interface ManagedQueueDepth {
  available: number;
  inFlight?: number;
  scheduled?: number;
  deadLetter?: number;
}

export interface ManagedStoreRecord<TValue = unknown> {
  key: string;
  value: TValue;
  updatedAt: number;
  etag?: string;
  metadata?: Record<string, string>;
}

export interface ManagedStorePutOptions {
  expectedEtag?: string;
}

export interface ManagedStoreQuery {
  prefix?: string;
  cursor?: string;
  limit?: number;
}

export interface ManagedStorePage<TValue = unknown> {
  items: ManagedStoreRecord<TValue>[];
  nextCursor?: string;
}

export interface ManagedMetricRecord {
  name: string;
  type: "counter" | "gauge" | "histogram";
  value: number;
  recordedAt: number;
  labels?: Record<string, string>;
  description?: string;
}

export interface ManagedTraceRecord {
  traceId: string;
  spanId: string;
  name: string;
  startedAt: number;
  endedAt?: number;
  status?: "ok" | "error";
  attributes?: Record<string, string | number | boolean>;
}

export interface ManagedBackendAdapter {
  readonly domain: ManagedBackendDomain;
  readonly capability: ManagedBackendCapability;
  readonly mode: ManagedBackendMode;
  readonly durability?: AdapterDurability;
  getHealth?(): Promise<AdapterHealthReport> | AdapterHealthReport;
  getManagedHealth?(): Promise<ManagedBackendHealthReport> | ManagedBackendHealthReport;
}

export interface ManagedBackendQueueAdapter<TPayload = unknown> extends ManagedBackendAdapter {
  readonly capability: "queue";
  enqueue(message: ManagedQueueMessage<TPayload>): Promise<ManagedQueueReceipt>;
  getDepth?(): Promise<ManagedQueueDepth> | ManagedQueueDepth;
}

export interface ManagedBackendStoreAdapter<TValue = unknown> extends ManagedBackendAdapter {
  readonly capability: "store";
  put(record: ManagedStoreRecord<TValue>, options?: ManagedStorePutOptions): Promise<void>;
  get(key: string): Promise<ManagedStoreRecord<TValue> | undefined>;
  list?(query?: ManagedStoreQuery): Promise<ManagedStorePage<TValue>>;
  delete?(key: string): Promise<boolean>;
}

export interface ManagedBackendObservabilityAdapter extends ManagedBackendAdapter {
  readonly capability: "observability";
  recordMetric(record: ManagedMetricRecord): Promise<void>;
  recordTrace(record: ManagedTraceRecord): Promise<void>;
  flush?(): Promise<void>;
}

export interface ManagedBackendSuite {
  queue?: ManagedBackendQueueAdapter;
  store?: ManagedBackendStoreAdapter;
  observability?: ManagedBackendObservabilityAdapter;
}

export interface ManagedBackendInventory {
  data?: Partial<ManagedBackendSuite>;
  compute?: Partial<ManagedBackendSuite>;
  dev?: Partial<ManagedBackendSuite>;
}

export type DataManagedBackendSuite = ManagedBackendSuite;
export type ComputeManagedBackendSuite = ManagedBackendSuite;
export type DevManagedBackendSuite = ManagedBackendSuite;

export function aggregateManagedBackendHealth(
  backends: ManagedBackendHealthReport[],
): ManagedBackendHealthSummary {
  const summary = aggregateAdapterHealth(backends);
  return {
    ...summary,
    backends,
  };
}

export async function resolveManagedBackendHealth(
  adapter: ManagedBackendAdapter | undefined,
  fallback: ManagedBackendHealthReport,
): Promise<ManagedBackendHealthReport> {
  if (!adapter) {
    return cloneManagedBackendHealth(fallback);
  }

  const report = adapter.getManagedHealth
    ? await adapter.getManagedHealth()
    : adapter.getHealth
      ? await adapter.getHealth()
      : undefined;

  if (!report) {
    return cloneManagedBackendHealth(fallback);
  }

  return normalizeManagedBackendHealth(report, fallback);
}

export function summarizeManagedBackendProfile(
  profile: ManagedBackendProfile,
): ManagedBackendProfileSummary {
  const credentialType = profile.credentialSchema?.type ?? "none";
  return {
    backendId: profile.backendId,
    providerId: profile.providerId,
    displayName: profile.displayName,
    endpoint: profile.endpoint,
    timeoutMs: profile.timeoutMs,
    credentialType,
    requiredCredentialFields: normalizeManagedBackendRequiredCredentialFields(
      profile.credentialSchema?.fields,
      credentialType,
    ),
    configuredCredentialFields: normalizeManagedBackendConfiguredCredentialFields(
      profile.configuredCredentialFields,
      credentialType,
    ),
    metadata: profile.metadata ? { ...profile.metadata } : undefined,
  };
}

export function normalizeManagedBackendCredentialKey(
  key: string,
  credentialType: ManagedBackendCredentialType,
): string {
  return MANAGED_BACKEND_CREDENTIAL_KEY_ALIASES[credentialType][key] ?? key;
}

export function normalizeManagedBackendConfiguredCredentialFields(
  fields: string[] | undefined,
  credentialType: ManagedBackendCredentialType,
): string[] {
  return [...new Set((fields ?? []).map((field) =>
    normalizeManagedBackendCredentialKey(field, credentialType)
  ))].sort((left, right) => left.localeCompare(right));
}

export function normalizeManagedBackendCredentialSchemaFields(
  fields: ManagedBackendCredentialFieldSchema[] | undefined,
  credentialType: ManagedBackendCredentialType,
): ManagedBackendCredentialFieldSchema[] {
  const normalizedFields = (fields ?? []).map((field) => ({
    ...field,
    key: normalizeManagedBackendCredentialKey(field.key, credentialType),
  }));
  const uniqueFieldKeys = new Set(normalizedFields.map((field) => field.key));

  if (uniqueFieldKeys.size !== normalizedFields.length) {
    throw new Error("managedBackend.credentialSchema.fields contains duplicate keys");
  }

  return normalizedFields;
}

export function normalizeManagedBackendRequiredCredentialFields(
  fields: ManagedBackendCredentialFieldSchema[] | undefined,
  credentialType: ManagedBackendCredentialType,
): string[] {
  return normalizeManagedBackendCredentialSchemaFields(fields, credentialType)
    .filter((field) => field.required !== false)
    .map((field) => field.key)
    .sort((left, right) => left.localeCompare(right));
}

function normalizeManagedBackendHealth(
  report: AdapterHealthReport | ManagedBackendHealthReport,
  fallback: ManagedBackendHealthReport,
): ManagedBackendHealthReport {
  const managedReport = report as Partial<ManagedBackendHealthReport>;

  return {
    ...cloneManagedBackendHealth(fallback),
    ...report,
    name: report.name,
    state: report.state,
    checkedAt: report.checkedAt,
    durable: report.durable ?? fallback.durable,
    durability: report.durability ?? fallback.durability,
    features: {
      ...(fallback.features ?? {}),
      ...(report.features ?? {}),
    },
    compatibility: report.compatibility ?? fallback.compatibility,
    lastError: report.lastError ?? fallback.lastError,
    domain: managedReport.domain ?? fallback.domain,
    capability: managedReport.capability ?? fallback.capability,
    mode: managedReport.mode ?? fallback.mode,
    profile: managedReport.profile
      ? cloneManagedBackendProfileSummary(managedReport.profile)
      : cloneManagedBackendProfileSummary(fallback.profile),
  };
}

function cloneManagedBackendHealth(
  report: ManagedBackendHealthReport,
): ManagedBackendHealthReport {
  return {
    ...report,
    features: report.features ? { ...report.features } : undefined,
    compatibility: report.compatibility ? { ...report.compatibility } : undefined,
    lastError: report.lastError
      ? {
          ...report.lastError,
          details: report.lastError.details ? { ...report.lastError.details } : undefined,
        }
      : undefined,
    profile: cloneManagedBackendProfileSummary(report.profile),
  };
}

function cloneManagedBackendProfileSummary(
  profile: ManagedBackendProfileSummary | undefined,
): ManagedBackendProfileSummary | undefined {
  if (!profile) {
    return undefined;
  }

  return {
    ...profile,
    requiredCredentialFields: [...profile.requiredCredentialFields],
    configuredCredentialFields: [...profile.configuredCredentialFields],
    metadata: profile.metadata ? { ...profile.metadata } : undefined,
  };
}
