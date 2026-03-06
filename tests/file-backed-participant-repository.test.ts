import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Participant } from "../src/domain/types";
import {
  decodeDeterministicCursor,
  type DeterministicCursorPayload,
} from "../src/infrastructure/repositories/file-backed-cursor";
import { FileBackedParticipantRepository } from "../src/infrastructure/repositories/file-backed-participant-repository";

function buildParticipant(
  id: string,
  role: Participant["role"],
  overrides: Partial<Participant> = {},
): Participant {
  return {
    id,
    role,
    displayName: `Participant ${id}`,
    skills: role === "worker" ? ["ml", "ops"] : ["review"],
    location: {
      latitude: 0,
      longitude: 0,
    },
    identityLevel: "basic",
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

describe("FileBackedParticipantRepository", () => {
  it("persists participants, role queries, and lifecycle entries across instances", async () => {
    const { directory, filePath } = await createTempFilePath("pact-file-participant-", "participants.json");

    try {
      const first = new FileBackedParticipantRepository({ filePath });
      await first.save(buildParticipant("worker-1", "worker"));
      await first.save(buildParticipant("issuer-1", "issuer"));
      await first.save(buildParticipant("worker-1", "worker", { displayName: "Worker One" }));

      const second = new FileBackedParticipantRepository({ filePath });
      const loaded = await second.getById("worker-1");
      expect(loaded?.displayName).toBe("Worker One");

      expect((await second.listByRole("worker")).map((participant) => participant.id)).toEqual(["worker-1"]);

      const filtered = await second.query({ role: "issuer" }, { limit: 10 });
      expect(filtered.items.map((participant) => participant.id)).toEqual(["issuer-1"]);

      const replay = await second.replay({ limit: 10 });
      expect(replay.entries.map((entry) => entry.action)).toEqual(["created", "created", "updated"]);
      expect(replay.entries[2]?.participant.displayName).toBe("Worker One");

      const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
        participants: unknown[];
        lifecycle: unknown[];
      };
      expect(Array.isArray(persisted.participants)).toBe(true);
      expect(Array.isArray(persisted.lifecycle)).toBe(true);
      expect(persisted.participants.length).toBe(2);
      expect(persisted.lifecycle.length).toBe(3);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves insertion ordering when participant roles are updated", async () => {
    const { directory, filePath } = await createTempFilePath("pact-file-participant-order-", "participants.json");

    try {
      const repository = new FileBackedParticipantRepository({ filePath });
      await repository.save(buildParticipant("participant-1", "worker"));
      await repository.save(buildParticipant("participant-2", "issuer"));
      await repository.save(buildParticipant("participant-1", "issuer"));

      expect((await repository.listByRole("worker"))).toHaveLength(0);
      expect((await repository.listByRole("issuer")).map((participant) => participant.id)).toEqual([
        "participant-1",
        "participant-2",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("supports filtered pagination with deterministic cursors", async () => {
    const { directory, filePath } = await createTempFilePath("pact-file-participant-page-", "participants.json");

    try {
      const repository = new FileBackedParticipantRepository({ filePath });
      await repository.save(buildParticipant("worker-1", "worker", { skills: ["ml"] }));
      await repository.save(buildParticipant("worker-2", "worker", { skills: ["ml", "ops"] }));
      await repository.save(buildParticipant("worker-3", "worker", { skills: ["ops"] }));
      await repository.save(buildParticipant("worker-4", "worker", { skills: ["ml"] }));

      const firstPage = await repository.query({ role: "worker", skill: "ml" }, { limit: 2 });
      expect(firstPage.items.map((participant) => participant.id)).toEqual(["worker-1", "worker-2"]);
      expect(firstPage.nextCursor).toBeDefined();

      const cursor = decodeDeterministicCursor(firstPage.nextCursor) as DeterministicCursorPayload;
      expect(cursor.id).toBe("worker-2");

      const secondPage = await repository.query(
        { role: "worker", skill: "ml" },
        { cursor: firstPage.nextCursor, limit: 2 },
      );
      expect(secondPage.items.map((participant) => participant.id)).toEqual(["worker-4"]);
      expect(secondPage.nextCursor).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects invalid cursors and caps large query limits", async () => {
    const { directory, filePath } = await createTempFilePath("pact-file-participant-limits-", "participants.json");

    try {
      const repository = new FileBackedParticipantRepository({ filePath });
      for (let index = 1; index <= 205; index += 1) {
        await repository.save(buildParticipant(`worker-${index}`, "worker"));
      }

      await expect(repository.query(undefined, { cursor: "not-a-cursor", limit: 1 })).rejects.toThrow(
        "invalid cursor",
      );
      await expect(repository.replay({ cursor: "not-a-cursor", limit: 1 })).rejects.toThrow(
        "invalid replay cursor",
      );

      const queryPage = await repository.query(undefined, { limit: 999 });
      expect(queryPage.items).toHaveLength(200);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
