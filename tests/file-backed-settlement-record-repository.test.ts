import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileBackedDurableSettlementRecordRepository } from "../src/infrastructure/repositories/file-backed-durable-settlement-record-repository";
import type { SettlementRecord } from "../src/application/settlement-records";

function buildRecord(
  index: number,
  overrides: Partial<SettlementRecord> = {},
): SettlementRecord {
  return {
    id: `record-${index}`,
    settlementId: "settlement-1",
    legId: `leg-${index}`,
    assetId: index % 2 === 0 ? "llm-gpt5" : "cloud-aws",
    rail: index % 2 === 0 ? "llm_metering" : "cloud_billing",
    connector: index % 2 === 0 ? "llm_token_metering" : "cloud_credit_billing",
    payerId: "issuer-1",
    payeeId: index % 2 === 0 ? "agent-1" : "agent-2",
    amount: 10 + index,
    unit: index % 2 === 0 ? "token" : "credit",
    status: "applied",
    externalReference: `ext-${index}`,
    createdAt: 1700000000000 + index,
    ...overrides,
  };
}

describe("FileBackedDurableSettlementRecordRepository", () => {
  it("persists records and lifecycle entries across repository instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pact-settlement-records-"));
    const filePath = join(directory, "records.json");

    try {
      const first = new FileBackedDurableSettlementRecordRepository({ filePath });
      await first.append(buildRecord(1));
      await first.reconcile("record-1", {
        reconciledBy: "auditor-1",
        note: "manual verification",
        reconciledAt: 1700000000100,
      });

      const second = new FileBackedDurableSettlementRecordRepository({ filePath });
      const loadedRecord = await second.getById("record-1");
      expect(loadedRecord?.status).toBe("reconciled");
      expect(loadedRecord?.reconciledBy).toBe("auditor-1");

      const replay = await second.replay({ fromOffset: 0, limit: 10 });
      expect(replay.entries.length).toBe(2);
      expect(replay.entries[0]?.action).toBe("created");
      expect(replay.entries[1]?.action).toBe("reconciled");

      const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
        records: unknown[];
        lifecycle: unknown[];
      };
      expect(Array.isArray(persisted.records)).toBe(true);
      expect(Array.isArray(persisted.lifecycle)).toBe(true);
      expect(persisted.records.length).toBe(1);
      expect(persisted.lifecycle.length).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
