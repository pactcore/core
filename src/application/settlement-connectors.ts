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
}

export interface SettlementConnectorResult {
  status: "applied";
  externalReference: string;
  processedAt: number;
  metadata?: Record<string, string>;
}

export interface LlmTokenMeteringConnector {
  applyMeteringCredit(input: SettlementConnectorRequest): Promise<SettlementConnectorResult>;
}

export interface CloudCreditBillingConnector {
  applyBillingCredit(input: SettlementConnectorRequest): Promise<SettlementConnectorResult>;
}

export interface ApiQuotaAllocationConnector {
  allocateQuota(input: SettlementConnectorRequest): Promise<SettlementConnectorResult>;
}

export interface SettlementConnectors {
  llmTokenMetering: LlmTokenMeteringConnector;
  cloudCreditBilling: CloudCreditBillingConnector;
  apiQuotaAllocation: ApiQuotaAllocationConnector;
}
