import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContainer } from "../src/application/container";
import type { Participant, ReputationRecord, Task } from "../src/domain/types";
import { InMemoryEventJournal } from "../src/infrastructure/event-bus/in-memory-event-journal";
import { SQLiteEventJournal } from "../src/infrastructure/event-bus/sqlite-event-journal";
import { SQLiteParticipantRepository } from "../src/infrastructure/repositories/sqlite-participant-repository";
import { SQLiteReputationRepository } from "../src/infrastructure/repositories/sqlite-reputation-repository";
import { SQLiteTaskRepository } from "../src/infrastructure/repositories/sqlite-task-repository";

function buildTask(id: string, overrides: Partial<Task> = {}): Task {
  const now = 1700000000000;
  return {
    id,
    title: `Task ${id}`,
    description: "sqlite repository task",
    issuerId: "issuer-1",
    paymentCents: 1250,
    constraints: {
      requiredSkills: ["analysis"],
      maxDistanceKm: 50,
      minReputation: 40,
      capacityRequired: 1,
    },
    location: {
      latitude: 37.7749,
      longitude: -122.4194,
    },
    status: "Created",
    validatorIds: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildParticipant(
  id: string,
  role: Participant["role"],
  overrides: Partial<Participant> = {},
): Participant {
  return {
    id,
    role,
    displayName: `Participant ${id}`,
    skills: [],
    location: {
      latitude: 0,
      longitude: 0,
    },
    ...overrides,
  };
}

function buildReputation(
  participantId: string,
  role: ReputationRecord["role"],
  score: number,
): ReputationRecord {
  return {
    participantId,
    role,
    score,
  };
}

async function createTempDatabasePath(prefix: string): Promise<{ directory: string; filePath: string }> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  return {
    directory,
    filePath: join(directory, "store.sqlite"),
  };
}

describe("SQLite repositories", () => {
  it("supports task save/get/list with update semantics", async () => {
    const { directory, filePath } = await createTempDatabasePath("pact-sqlite-task-");

    try {
      const repository = new SQLiteTaskRepository({ filePath });
      await repository.save(buildTask("task-1"));
      await repository.save(buildTask("task-2"));
      await repository.save(buildTask("task-1", { status: "Assigned", assigneeId: "worker-1" }));

      const loaded = await repository.getById("task-1");
      expect(loaded?.status).toBe("Assigned");
      expect(loaded?.assigneeId).toBe("worker-1");

      const list = await repository.list();
      expect(list.map((task) => task.id)).toEqual(["task-1", "task-2"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns undefined for missing task ids", async () => {
    const { directory, filePath } = await createTempDatabasePath("pact-sqlite-task-missing-");

    try {
      const repository = new SQLiteTaskRepository({ filePath });
      expect(await repository.getById("missing-task")).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists tasks across repository instances", async () => {
    const { directory, filePath } = await createTempDatabasePath("pact-sqlite-task-persist-");

    try {
      const first = new SQLiteTaskRepository({ filePath });
      await first.save(buildTask("task-persist"));

      const second = new SQLiteTaskRepository({ filePath });
      const loaded = await second.getById("task-persist");
      expect(loaded?.title).toBe("Task task-persist");
      expect((await second.list()).length).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("supports participant save/get and listByRole", async () => {
    const { directory, filePath } = await createTempDatabasePath("pact-sqlite-participant-");

    try {
      const repository = new SQLiteParticipantRepository({ filePath });
      await repository.save(buildParticipant("worker-1", "worker"));
      await repository.save(buildParticipant("worker-2", "worker"));
      await repository.save(buildParticipant("issuer-1", "issuer"));

      const loaded = await repository.getById("worker-1");
      expect(loaded?.id).toBe("worker-1");

      const workers = await repository.listByRole("worker");
      expect(workers.map((participant) => participant.id)).toEqual(["worker-1", "worker-2"]);

      const issuers = await repository.listByRole("issuer");
      expect(issuers.map((participant) => participant.id)).toEqual(["issuer-1"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps insertion ordering semantics when participant roles are updated", async () => {
    const { directory, filePath } = await createTempDatabasePath("pact-sqlite-participant-order-");

    try {
      const repository = new SQLiteParticipantRepository({ filePath });
      await repository.save(buildParticipant("participant-1", "worker"));
      await repository.save(buildParticipant("participant-2", "issuer"));
      await repository.save(buildParticipant("participant-1", "issuer"));

      expect((await repository.listByRole("worker")).length).toBe(0);
      expect((await repository.listByRole("issuer")).map((participant) => participant.id)).toEqual([
        "participant-1",
        "participant-2",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists participants across repository instances", async () => {
    const { directory, filePath } = await createTempDatabasePath("pact-sqlite-participant-persist-");

    try {
      const first = new SQLiteParticipantRepository({ filePath });
      await first.save(buildParticipant("agent-1", "agent"));

      const second = new SQLiteParticipantRepository({ filePath });
      const loaded = await second.getById("agent-1");
      expect(loaded?.displayName).toBe("Participant agent-1");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("supports reputation save/get with overwrite semantics", async () => {
    const { directory, filePath } = await createTempDatabasePath("pact-sqlite-reputation-");

    try {
      const repository = new SQLiteReputationRepository({ filePath });
      await repository.save(buildReputation("participant-1", "worker", 81));
      expect((await repository.get("participant-1"))?.score).toBe(81);

      await repository.save(buildReputation("participant-1", "worker", 44));
      const updated = await repository.get("participant-1");
      expect(updated?.score).toBe(44);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists reputation records across repository instances", async () => {
    const { directory, filePath } = await createTempDatabasePath("pact-sqlite-reputation-persist-");

    try {
      const first = new SQLiteReputationRepository({ filePath });
      await first.save(buildReputation("participant-2", "validator", 73));

      const second = new SQLiteReputationRepository({ filePath });
      const loaded = await second.get("participant-2");
      expect(loaded?.role).toBe("validator");
      expect(loaded?.score).toBe(73);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses SQLite-backed repositories when PACT_DB_FILE is set", async () => {
    const { directory, filePath } = await createTempDatabasePath("pact-sqlite-container-");

    try {
      const first = createContainer(undefined, {
        env: {
          PACT_DB_FILE: filePath,
        },
      });
      expect(first.eventJournal).toBeInstanceOf(SQLiteEventJournal);

      await first.pactID.registerParticipant({
        id: "worker-sql",
        role: "worker",
        displayName: "Worker SQL",
      });
      await first.pactTasks.createTask({
        issuerId: "issuer-sql",
        title: "Persisted task",
        description: "task persisted through sqlite repo",
        paymentCents: 600,
        location: { latitude: 0, longitude: 0 },
        constraints: {
          requiredSkills: [],
          maxDistanceKm: 1000,
          minReputation: 0,
          capacityRequired: 1,
        },
      });

      const second = createContainer(undefined, {
        env: {
          PACT_DB_FILE: filePath,
        },
      });

      expect(await second.pactID.getIdentityLevel("worker-sql")).toBe("basic");
      expect((await second.pactTasks.listTasks()).length).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps in-memory behavior when PACT_DB_FILE is not set", () => {
    const container = createContainer(undefined, {
      env: {},
    });
    expect(container.eventJournal).toBeInstanceOf(InMemoryEventJournal);
  });
});
