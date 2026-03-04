import { describe, expect, it } from "bun:test";
import { InMemoryDurableSettlementRecordRepository } from "../src/infrastructure/repositories/in-memory-durable-settlement-record-repository";
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

describe("InMemoryDurableSettlementRecordRepository", () => {
  it("supports filtered query pagination", async () => {
    const repository = new InMemoryDurableSettlementRecordRepository();

    for (let i = 0; i < 5; i += 1) {
      await repository.append(buildRecord(i));
    }

    const firstPage = await repository.query({ settlementId: "settlement-1" }, { limit: 2 });
    expect(firstPage.items.length).toBe(2);
    expect(firstPage.nextCursor).toBe("2");

    const secondPage = await repository.query(
      { settlementId: "settlement-1" },
      { cursor: firstPage.nextCursor, limit: 2 },
    );
    expect(secondPage.items.length).toBe(2);
    expect(secondPage.nextCursor).toBe("4");

    const finalPage = await repository.query(
      { settlementId: "settlement-1" },
      { cursor: secondPage.nextCursor, limit: 2 },
    );
    expect(finalPage.items.length).toBe(1);
    expect(finalPage.nextCursor).toBeUndefined();
  });

  it("replays lifecycle entries with offset pagination", async () => {
    const repository = new InMemoryDurableSettlementRecordRepository();

    await repository.append(buildRecord(1));
    await repository.append(buildRecord(2));

    const replayPage = await repository.replay({ fromOffset: 0, limit: 1 });
    expect(replayPage.entries.length).toBe(1);
    expect(replayPage.entries[0]?.action).toBe("created");
    expect(replayPage.nextOffset).toBe(1);

    const nextReplayPage = await repository.replay({
      fromOffset: replayPage.nextOffset,
      limit: 5,
    });
    expect(nextReplayPage.entries.length).toBe(1);
    expect(nextReplayPage.entries[0]?.offset).toBe(1);
    expect(nextReplayPage.nextOffset).toBeUndefined();
  });
});
