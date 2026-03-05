import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContainer } from "../src/application/container";
import type { DomainEvent } from "../src/application/contracts";
import { SQLiteEventJournal } from "../src/infrastructure/event-bus/sqlite-event-journal";

function buildEvent(index: number): DomainEvent<Record<string, unknown>> {
  return {
    name: `sqlite.event.${index}`,
    payload: {
      index,
      marker: `m-${index}`,
    },
    createdAt: 1700000000000 + index,
  };
}

async function createTempDatabasePath(prefix: string): Promise<{ directory: string; filePath: string }> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  return {
    directory,
    filePath: join(directory, "events.sqlite"),
  };
}

describe("SQLiteEventJournal", () => {
  it("appends events, returns sequential offsets, and supports replay pagination", async () => {
    const { directory, filePath } = await createTempDatabasePath("pact-sqlite-journal-");

    try {
      const journal = new SQLiteEventJournal({ filePath });
      const mutablePayload = { nested: { marker: "stable" } };

      const first = await journal.append({
        name: "sqlite.event.mutable",
        payload: mutablePayload,
        createdAt: 1700000000100,
      });
      mutablePayload.nested.marker = "mutated";

      const second = await journal.append(buildEvent(2));
      const third = await journal.append(buildEvent(3));

      expect(first.offset).toBe(0);
      expect(second.offset).toBe(1);
      expect(third.offset).toBe(2);
      expect(await journal.latestOffset()).toBe(2);

      const pageOne = await journal.replay(0, 2);
      expect(pageOne.length).toBe(2);
      expect(pageOne[0]?.event.name).toBe("sqlite.event.mutable");
      expect((pageOne[0]?.event.payload as { nested: { marker: string } }).nested.marker).toBe("stable");

      const pageTwo = await journal.replay(2, 2);
      expect(pageTwo.length).toBe(1);
      expect(pageTwo[0]?.offset).toBe(2);
      expect(pageTwo[0]?.event.name).toBe("sqlite.event.3");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists event data across journal instances", async () => {
    const { directory, filePath } = await createTempDatabasePath("pact-sqlite-journal-persist-");

    try {
      const first = new SQLiteEventJournal({ filePath });
      await first.append(buildEvent(1));
      await first.append(buildEvent(2));

      const second = new SQLiteEventJournal({ filePath });
      const replay = await second.replay(0, 10);
      expect(replay.length).toBe(2);
      expect(replay[0]?.event.name).toBe("sqlite.event.1");
      expect(replay[1]?.event.name).toBe("sqlite.event.2");
      expect(await second.latestOffset()).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("validates replay arguments and enforces the maximum replay limit", async () => {
    const { directory, filePath } = await createTempDatabasePath("pact-sqlite-journal-limit-");

    try {
      const journal = new SQLiteEventJournal({ filePath });

      await expect(journal.replay(-1, 10)).rejects.toThrow("invalid fromOffset");
      await expect(journal.replay(0, 0)).rejects.toThrow("invalid limit");

      for (let index = 0; index < 520; index += 1) {
        await journal.append(buildEvent(index));
      }

      const replay = await journal.replay(0, 1000);
      expect(replay.length).toBe(500);
      expect(replay[0]?.offset).toBe(0);
      expect(replay[499]?.offset).toBe(499);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("prefers SQLite event journal wiring when PACT_DB_FILE is set", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pact-sqlite-journal-env-"));
    const dbFile = join(directory, "shared.sqlite");
    const jsonFile = join(directory, "events.json");

    try {
      const container = createContainer(undefined, {
        env: {
          PACT_DB_FILE: dbFile,
          PACT_EVENT_JOURNAL_STORE_FILE: jsonFile,
        },
      });

      expect(container.eventJournal).toBeInstanceOf(SQLiteEventJournal);

      await container.pactHeartbeat.registerTask({
        name: "sqlite-heartbeat",
        intervalMs: 1000,
        startAt: 1700000000000,
      });

      const replay = await container.eventJournal.replay(0, 10);
      expect(replay.length).toBeGreaterThan(0);
      expect(replay[0]?.event.name).toBe("heartbeat.task_registered");
      await expect(stat(jsonFile)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
