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

export interface SettlementConnectorRetryPolicy {
  maxRetries: number;
  backoffMs: number;
}

export type SettlementConnectorHealthState = "healthy" | "degraded" | "unhealthy";

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
  lastFailure?: SettlementConnectorFailure;
}

export interface ManagedSettlementConnector {
  getHealth(): SettlementConnectorHealth;
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
