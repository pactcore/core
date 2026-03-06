import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContainer } from "../src/application/container";

async function createTempPaths(prefix: string): Promise<{
  directory: string;
  dbFile: string;
  taskFile: string;
  participantFile: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  return {
    directory,
    dbFile: join(directory, "store.sqlite"),
    taskFile: join(directory, "tasks.json"),
    participantFile: join(directory, "participants.json"),
  };
}

describe("persistence wiring", () => {
  it("uses file-backed task storage when PACT_TASK_STORE_FILE is configured", async () => {
    const { directory, taskFile } = await createTempPaths("pact-persistence-task-env-");

    try {
      const first = createContainer(undefined, {
        env: {
          PACT_TASK_STORE_FILE: taskFile,
        },
      });

      await first.pactTasks.createTask({
        issuerId: "issuer-task-env",
        title: "Persistent task",
        description: "stored in file-backed task repository",
        paymentCents: 250,
        location: { latitude: 0, longitude: 0 },
        constraints: {
          requiredSkills: [],
          maxDistanceKm: 100,
          minReputation: 0,
          capacityRequired: 1,
        },
      });

      const second = createContainer(undefined, {
        env: {
          PACT_TASK_STORE_FILE: taskFile,
        },
      });

      expect((await second.pactTasks.listTasks())).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses file-backed participant storage when PACT_PARTICIPANT_STORE_FILE is configured", async () => {
    const { directory, participantFile } = await createTempPaths("pact-persistence-participant-env-");

    try {
      const first = createContainer(undefined, {
        env: {
          PACT_PARTICIPANT_STORE_FILE: participantFile,
        },
      });

      await first.pactID.registerParticipant({
        id: "participant-file-1",
        role: "worker",
        displayName: "Participant File",
      });

      const second = createContainer(undefined, {
        env: {
          PACT_PARTICIPANT_STORE_FILE: participantFile,
        },
      });

      expect((await second.pactID.listParticipants()).map((participant) => participant.id)).toEqual([
        "participant-file-1",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("lets file-backed task and participant stores override SQLite-backed selection", async () => {
    const { directory, dbFile, taskFile, participantFile } = await createTempPaths("pact-persistence-override-");

    try {
      const first = createContainer(undefined, {
        env: {
          PACT_DB_FILE: dbFile,
          PACT_TASK_STORE_FILE: taskFile,
          PACT_PARTICIPANT_STORE_FILE: participantFile,
        },
      });

      await first.pactID.registerParticipant({
        id: "participant-override-1",
        role: "worker",
        displayName: "Participant Override",
      });
      await first.pactTasks.createTask({
        issuerId: "issuer-override-1",
        title: "Override task",
        description: "stored outside sqlite",
        paymentCents: 300,
        location: { latitude: 0, longitude: 0 },
        constraints: {
          requiredSkills: [],
          maxDistanceKm: 100,
          minReputation: 0,
          capacityRequired: 1,
        },
      });

      const withOverrides = createContainer(undefined, {
        env: {
          PACT_DB_FILE: dbFile,
          PACT_TASK_STORE_FILE: taskFile,
          PACT_PARTICIPANT_STORE_FILE: participantFile,
        },
      });
      expect((await withOverrides.pactID.listParticipants()).map((participant) => participant.id)).toEqual([
        "participant-override-1",
      ]);
      expect((await withOverrides.pactTasks.listTasks())).toHaveLength(1);

      const sqliteOnly = createContainer(undefined, {
        env: {
          PACT_DB_FILE: dbFile,
        },
      });
      expect(await sqliteOnly.pactID.listParticipants()).toHaveLength(0);
      expect(await sqliteOnly.pactTasks.listTasks()).toHaveLength(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
