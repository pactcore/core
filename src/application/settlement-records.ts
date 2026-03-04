import type { SettlementRail } from "./settlement-connectors";

export type ManagedSettlementRail = Exclude<SettlementRail, "onchain_stablecoin" | "custom">;

export type SettlementRecordConnector =
  | "llm_token_metering"
  | "cloud_credit_billing"
  | "api_quota_allocation";

export type SettlementRecordStatus = "applied" | "reconciled";

export interface SettlementRecord {
  id: string;
  settlementId: string;
  legId: string;
  assetId: string;
  rail: ManagedSettlementRail;
  connector: SettlementRecordConnector;
  payerId: string;
  payeeId: string;
  amount: number;
  unit: string;
  status: SettlementRecordStatus;
  externalReference: string;
  connectorMetadata?: Record<string, string>;
  createdAt: number;
  reconciledAt?: number;
  reconciledBy?: string;
  reconciliationNote?: string;
}

export interface SettlementRecordQueryFilter {
  settlementId?: string;
  assetId?: string;
  rail?: ManagedSettlementRail;
  payerId?: string;
  payeeId?: string;
  status?: SettlementRecordStatus;
  reconciledBy?: string;
}

export interface SettlementRecordPageRequest {
  cursor?: string;
  limit?: number;
}

export interface SettlementRecordPage {
  items: SettlementRecord[];
  nextCursor?: string;
}

export interface ReconcileSettlementRecordInput {
  reconciledBy?: string;
  note?: string;
  reconciledAt?: number;
}

export type SettlementRecordLifecycleAction = "created" | "reconciled";

export interface SettlementRecordLifecycleEntry {
  offset: number;
  action: SettlementRecordLifecycleAction;
  recordId: string;
  settlementId: string;
  status: SettlementRecordStatus;
  occurredAt: number;
  record: SettlementRecord;
}

export interface SettlementRecordReplayRequest {
  fromOffset?: number;
  limit?: number;
}

export interface SettlementRecordReplayPage {
  entries: SettlementRecordLifecycleEntry[];
  nextOffset?: number;
}

export interface SettlementRecordRepository {
  append(record: SettlementRecord): Promise<void>;
  getById(recordId: string): Promise<SettlementRecord | undefined>;
  query(
    filter?: SettlementRecordQueryFilter,
    page?: SettlementRecordPageRequest,
  ): Promise<SettlementRecordPage>;
  reconcile(recordId: string, input?: ReconcileSettlementRecordInput): Promise<SettlementRecord>;
  replay(request?: SettlementRecordReplayRequest): Promise<SettlementRecordReplayPage>;
}
