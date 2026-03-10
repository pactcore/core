export type SettlementRail =
  | "onchain_stablecoin"
  | "llm_metering"
  | "cloud_billing"
  | "api_quota"
  | "custom";

export interface SettlementConnectorRequest {
  settlementId: string;
  recordId: string;
  legId: string;
  assetId: string;
  payerId: string;
  payeeId: string;
  amount: number;
  unit: string;
  idempotencyKey?: string;
}

export interface SettlementConnectorResult {
  status: "applied";
  externalReference: string;
  processedAt: number;
  metadata?: Record<string, string>;
}

export type SettlementConnectorKind =
  | "llm_token_metering"
  | "cloud_credit_billing"
  | "api_quota_allocation";

export type SettlementConnectorOperation =
  | "apply_metering_credit"
  | "apply_billing_credit"
  | "allocate_quota";

export type SettlementConnectorCredentialType =
  | "none"
  | "api_key"
  | "bearer"
  | "basic"
  | "oauth2"
  | "service_account";

export interface SettlementConnectorCredentialFieldSchema {
  key: string;
  required?: boolean;
  secret?: boolean;
}

export interface SettlementConnectorCredentialSchema {
  type: SettlementConnectorCredentialType;
  fields: SettlementConnectorCredentialFieldSchema[];
}

export interface SettlementConnectorProviderProfile {
  id: string;
  providerId: string;
  displayName?: string;
  endpoint?: string;
  timeoutMs?: number;
  credentialSchema: SettlementConnectorCredentialSchema;
  credentials: Record<string, string>;
  metadata?: Record<string, string>;
}

export interface SettlementConnectorTransportRequest {
  connector: SettlementConnectorKind;
  operation: SettlementConnectorOperation;
  method: "POST";
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface SettlementConnectorTransportResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface SettlementConnectorTransport {
  send(request: SettlementConnectorTransportRequest): Promise<SettlementConnectorTransportResponse>;
}

export interface SettlementConnectorProfileSummary {
  profileId: string;
  providerId: string;
  displayName?: string;
  endpoint?: string;
  credentialType: SettlementConnectorCredentialType;
  configuredCredentialFields: string[];
}

export interface SettlementConnectorRetryPolicy {
  maxRetries: number;
  backoffMs: number;
  backoffStrategy?: "linear" | "exponential";
  maxBackoffMs?: number;
}

export interface SettlementConnectorCircuitBreakerPolicy {
  failureThreshold: number;
  cooldownMs: number;
}

export type SettlementConnectorHealthState = "open" | "half_open" | "closed";

export interface SettlementConnectorFailure {
  attempt: number;
  failedAt: number;
  message: string;
  settlementId: string;
  recordId: string;
  idempotencyKey?: string;
}

export interface SettlementConnectorHealth {
  state: SettlementConnectorHealthState;
  retryPolicy: SettlementConnectorRetryPolicy;
  circuitBreaker: SettlementConnectorCircuitBreakerPolicy;
  timeoutMs: number;
  consecutiveFailures: number;
  lastFailureAt?: number;
  lastError?: string;
  lastFailure?: SettlementConnectorFailure;
  profile?: SettlementConnectorProfileSummary;
}

export interface ManagedSettlementConnector {
  getHealth(): SettlementConnectorHealth;
  resetHealth(): void;
  hasExternalReference(externalReference: string): Promise<boolean>;
}

export interface LlmTokenMeteringConnector extends ManagedSettlementConnector {
  applyMeteringCredit(input: SettlementConnectorRequest): Promise<SettlementConnectorResult>;
}

export interface CloudCreditBillingConnector extends ManagedSettlementConnector {
  applyBillingCredit(input: SettlementConnectorRequest): Promise<SettlementConnectorResult>;
}

export interface ApiQuotaAllocationConnector extends ManagedSettlementConnector {
  allocateQuota(input: SettlementConnectorRequest): Promise<SettlementConnectorResult>;
}

export interface SettlementConnectors {
  llmTokenMetering: LlmTokenMeteringConnector;
  cloudCreditBilling: CloudCreditBillingConnector;
  apiQuotaAllocation: ApiQuotaAllocationConnector;
}
