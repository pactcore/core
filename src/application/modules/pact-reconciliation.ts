import type { SettlementRecord } from "../settlement-records";
import {
  PactEconomics,
  type ConnectorHealthReport,
} from "./pact-economics";

export interface UnreconciledSettlementView {
  settlementId: string;
  pendingRecordCount: number;
  recordIds: string[];
  connectors: SettlementRecord["connector"][];
  oldestCreatedAt: number;
  records: SettlementRecord[];
}

export interface ReconciliationCycleResult {
  startedAt: number;
  completedAt: number;
  scannedRecordCount: number;
  reconciledRecordCount: number;
  pendingRecordCount: number;
  reconciledRecordIds: string[];
  connectorHealth: ConnectorHealthReport[];
}

export interface PactReconciliationOptions {
  pactEconomics: PactEconomics;
}

export class PactReconciliation {
  private readonly pactEconomics: PactEconomics;

  constructor(options: PactReconciliationOptions) {
    this.pactEconomics = options.pactEconomics;
  }

  getConnectorHealth(): ConnectorHealthReport[] {
    return this.pactEconomics.getConnectorHealth();
  }

  async listUnreconciledSettlements(): Promise<UnreconciledSettlementView[]> {
    const records = await this.pactEconomics.listSettlementRecords({ status: "applied" });
    const grouped = new Map<string, UnreconciledSettlementView>();

    for (const record of records) {
      const existing = grouped.get(record.settlementId);
      if (existing) {
        existing.pendingRecordCount += 1;
        existing.recordIds.push(record.id);
        if (!existing.connectors.includes(record.connector)) {
          existing.connectors.push(record.connector);
        }
        existing.oldestCreatedAt = Math.min(existing.oldestCreatedAt, record.createdAt);
        existing.records.push(this.cloneRecord(record));
        continue;
      }

      grouped.set(record.settlementId, {
        settlementId: record.settlementId,
        pendingRecordCount: 1,
        recordIds: [record.id],
        connectors: [record.connector],
        oldestCreatedAt: record.createdAt,
        records: [this.cloneRecord(record)],
      });
    }

    return [...grouped.values()].sort((left, right) => {
      if (left.oldestCreatedAt === right.oldestCreatedAt) {
        return left.settlementId.localeCompare(right.settlementId);
      }
      return left.oldestCreatedAt - right.oldestCreatedAt;
    });
  }

  async runReconciliationCycle(): Promise<ReconciliationCycleResult> {
    const startedAt = Date.now();
    const unreconciledRecords = await this.pactEconomics.listSettlementRecords({ status: "applied" });
    const reconciledRecordIds: string[] = [];

    for (const record of unreconciledRecords) {
      const matched = await this.pactEconomics.canReconcileSettlementRecord(record);
      if (!matched) {
        continue;
      }

      const reconciled = await this.pactEconomics.reconcileSettlementRecord({
        recordId: record.id,
        reconciledBy: "pact-reconciliation",
        note: "connector ledger matched during reconciliation cycle",
      });
      reconciledRecordIds.push(reconciled.id);
    }

    const pending = await this.listUnreconciledSettlements();
    return {
      startedAt,
      completedAt: Date.now(),
      scannedRecordCount: unreconciledRecords.length,
      reconciledRecordCount: reconciledRecordIds.length,
      pendingRecordCount: pending.reduce((sum, settlement) => sum + settlement.pendingRecordCount, 0),
      reconciledRecordIds,
      connectorHealth: this.getConnectorHealth(),
    };
  }

  private cloneRecord(record: SettlementRecord): SettlementRecord {
    return {
      ...record,
      connectorMetadata: record.connectorMetadata ? { ...record.connectorMetadata } : undefined,
    };
  }
}
