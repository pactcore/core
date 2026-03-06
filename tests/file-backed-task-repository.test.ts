import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Task } from "../src/domain/types";
import {
  decodeDeterministicCursor,
  type DeterministicCursorPayload,
} from "../src/infrastructure/repositories/file-backed-cursor";
import { FileBackedTaskRepository } from "../src/infrastructure/repositories/file-backed-task-repository";

function buildTask(index: number, overrides: Partial<Task> = {}): Task {
  const now = 1700000000000 + index * 100;

  return {
    id: `task-${index}`,
    title: `Task ${index}`,
    description: "file-backed repository task",
    issuerId: index % 2 === 0 ? "issuer-2" : "issuer-1",
    paymentCents: 1000 + index,
    constraints: {
      requiredSkills: index % 2 === 0 ? ["ml"] : ["ops"],
      maxDistanceKm: 50,
      minReputation: 10,
      capacityRequired: 1,
    },
    location: {
      latitude: 0,
      longitude: 0,
    },
    status: "Created",
    validatorIds: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function createTempFilePath(prefix: string, fileName: string): Promise<{ directory: string; filePath: string }> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  return {
    directory,
    filePath: join(directory, fileName),
  };
}

describe("FileBackedTaskRepository", () => {
  it("persists tasks, lifecycle entries, and atomic snapshots across instances", async () => {
    const { directory, filePath } = await createTempFilePath("pact-file-task-", "tasks.json");

    try {
      const first = new FileBackedTaskRepository({ filePath });
      await first.save(buildTask(1));
      await first.save(buildTask(2));
      await first.save(buildTask(1, { status: "Assigned", assigneeId: "worker-1", updatedAt: 1700000000200 }));

      const second = new FileBackedTaskRepository({ filePath });
      const loaded = await second.getById("task-1");
      expect(loaded?.status).toBe("Assigned");
      expect(loaded?.assigneeId).toBe("worker-1");

      expect((await second.list()).map((task) => task.id)).toEqual(["task-1", "task-2"]);

      const filtered = await second.query({ status: "Assigned", assigneeId: "worker-1" }, { limit: 10 });
      expect(filtered.items.map((task) => task.id)).toEqual(["task-1"]);

      const replay = await second.replay({ limit: 10 });
      expect(replay.entries.map((entry) => entry.action)).toEqual(["created", "created", "updated"]);
      expect(replay.entries[2]?.task.status).toBe("Assigned");

      const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
        tasks: unknown[];
        lifecycle: unknown[];
      };
      expect(Array.isArray(persisted.tasks)).toBe(true);
      expect(Array.isArray(persisted.lifecycle)).toBe(true);
      expect(persisted.tasks.length).toBe(2);
      expect(persisted.lifecycle.length).toBe(3);

      const files = await readdir(directory);
      expect(files.includes("tasks.json.tmp")).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves creation ordering when existing tasks are updated", async () => {
    const { directory, filePath } = await createTempFilePath("pact-file-task-order-", "tasks.json");

    try {
      const repository = new FileBackedTaskRepository({ filePath });
      await repository.save(buildTask(1));
      await repository.save(buildTask(2));
      await repository.save(buildTask(1, { status: "Completed", updatedAt: 1700000000300 }));

      expect((await repository.list()).map((task) => task.id)).toEqual(["task-1", "task-2"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("supports filtered pagination with deterministic cursors", async () => {
    const { directory, filePath } = await createTempFilePath("pact-file-task-page-", "tasks.json");

    try {
      const repository = new FileBackedTaskRepository({ filePath });
      await repository.save(buildTask(1, { issuerId: "issuer-1" }));
      await repository.save(buildTask(2, { issuerId: "issuer-1" }));
      await repository.save(buildTask(3, { issuerId: "issuer-2" }));
      await repository.save(buildTask(4, { issuerId: "issuer-1" }));

      const firstPage = await repository.query({ issuerId: "issuer-1" }, { limit: 2 });
      expect(firstPage.items.map((task) => task.id)).toEqual(["task-1", "task-2"]);
      expect(firstPage.nextCursor).toBeDefined();

      const cursor = decodeDeterministicCursor(firstPage.nextCursor) as DeterministicCursorPayload;
      expect(cursor.id).toBe("task-2");

      const secondPage = await repository.query(
        { issuerId: "issuer-1" },
        { cursor: firstPage.nextCursor, limit: 2 },
      );
      expect(secondPage.items.map((task) => task.id)).toEqual(["task-4"]);
      expect(secondPage.nextCursor).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects invalid cursors", async () => {
    const { directory, filePath } = await createTempFilePath("pact-file-task-invalid-cursor-", "tasks.json");

    try {
      const repository = new FileBackedTaskRepository({ filePath });
      await repository.save(buildTask(1));

      await expect(repository.query(undefined, { cursor: "not-a-cursor", limit: 1 })).rejects.toThrow(
        "invalid cursor",
      );
      await expect(repository.replay({ cursor: "not-a-cursor", limit: 1 })).rejects.toThrow(
        "invalid replay cursor",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("caps large query and replay limits to configured maximums", async () => {
    const { directory, filePath } = await createTempFilePath("pact-file-task-limits-", "tasks.json");

    try {
      const repository = new FileBackedTaskRepository({ filePath });
      for (let index = 1; index <= 205; index += 1) {
        await repository.save(buildTask(index));
      }

      const queryPage = await repository.query(undefined, { limit: 999 });
      expect(queryPage.items).toHaveLength(200);

      const replayPage = await repository.replay({ limit: 999 });
      expect(replayPage.entries).toHaveLength(205);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
