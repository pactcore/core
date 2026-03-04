import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContainer } from "../src/application/container";
import type { DomainEvent } from "../src/application/contracts";
import { FileBackedEventJournal } from "../src/infrastructure/event-bus/file-backed-event-journal";
import { InMemoryEventJournal } from "../src/infrastructure/event-bus/in-memory-event-journal";

function buildEvent(index: number): DomainEvent<Record<string, unknown>> {
  return {
    name: `event.${index}`,
    payload: {
      index,
      marker: `m-${index}`,
    },
    createdAt: 1700000000000 + index,
  };
}

describe("FileBackedEventJournal", () => {
  it("persists event records and supports replay pagination across instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pact-event-journal-"));
    const filePath = join(directory, "event-journal.json");

    try {
      const first = new FileBackedEventJournal({ filePath });
      await first.append(buildEvent(1));
      await first.append(buildEvent(2));
      await first.append(buildEvent(3));
      await first.append(buildEvent(4));

      const pageOne = await first.replay(0, 2);
      expect(pageOne.length).toBe(2);
      expect(pageOne[0]?.offset).toBe(0);
      expect(pageOne[1]?.offset).toBe(1);

      const pageTwo = await first.replay(2, 2);
      expect(pageTwo.length).toBe(2);
      expect(pageTwo[0]?.event.name).toBe("event.3");
      expect(pageTwo[1]?.event.name).toBe("event.4");

      expect(await first.latestOffset()).toBe(3);

      const second = new FileBackedEventJournal({ filePath });
      const replay = await second.replay(1, 2);
      expect(replay.length).toBe(2);
      expect(replay[0]?.offset).toBe(1);
      expect(replay[0]?.event.name).toBe("event.2");
      expect(replay[1]?.offset).toBe(2);
      expect(replay[1]?.event.name).toBe("event.3");
      expect(await second.latestOffset()).toBe(3);

      const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
        records: Array<{ offset: number; event: { name: string } }>;
      };
      expect(persisted.records.length).toBe(4);
      expect(persisted.records[0]?.offset).toBe(0);
      expect(persisted.records[3]?.event.name).toBe("event.4");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps in-memory journal by default and switches to file-backed via env wiring", async () => {
    const inMemoryContainer = createContainer(undefined, {
      env: {},
    });
    expect(inMemoryContainer.eventJournal).toBeInstanceOf(InMemoryEventJournal);

    const directory = await mkdtemp(join(tmpdir(), "pact-event-journal-env-"));
    const filePath = join(directory, "events.json");

    try {
      const fileBackedContainer = createContainer(undefined, {
        env: { PACT_EVENT_JOURNAL_STORE_FILE: filePath },
      });
      expect(fileBackedContainer.eventJournal).toBeInstanceOf(FileBackedEventJournal);

      await fileBackedContainer.pactHeartbeat.registerTask({
        name: "durable-heartbeat",
        intervalMs: 1000,
        startAt: 1700000000001,
      });

      const replay = await fileBackedContainer.eventJournal.replay(0, 10);
      expect(replay.length).toBeGreaterThan(0);
      expect(replay[0]?.event.name).toBe("heartbeat.task_registered");

      const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
        records: unknown[];
      };
      expect(Array.isArray(persisted.records)).toBe(true);
      expect(persisted.records.length).toBe(replay.length);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
