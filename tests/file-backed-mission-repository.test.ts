import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContainer } from "../src/application/container";
import { FileBackedMissionRepository } from "../src/infrastructure/repositories/file-backed-mission-repository";
import type { MissionEnvelope } from "../src/domain/types";

function buildMission(index: number, overrides: Partial<MissionEnvelope> = {}): MissionEnvelope {
  const now = 1700000000000 + index * 100;

  return {
    id: `mission-${index}`,
    issuerId: "issuer-1",
    title: `Mission ${index}`,
    budgetCents: 5000 + index,
    context: {
      objective: `Objective ${index}`,
      constraints: ["no_pii"],
      successCriteria: ["accuracy>=0.9"],
    },
    status: "Open",
    targetAgentIds: ["agent-1"],
    executionSteps: [],
    evidenceBundles: [],
    verdicts: [],
    challenges: [],
    retryCount: 0,
    maxRetries: 2,
    escalationCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("FileBackedMissionRepository", () => {
  it("persists mission state, supports filtered query pagination, and replays lifecycle", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pact-mission-store-"));
    const filePath = join(directory, "missions.json");

    try {
      const first = new FileBackedMissionRepository({ filePath });
      const mission = buildMission(1);

      await first.save(mission);
      await first.save({
        ...mission,
        status: "InProgress",
        claimedBy: "agent-1",
        updatedAt: mission.updatedAt + 50,
      });
      await first.save(
        buildMission(2, {
          issuerId: "issuer-2",
          status: "Failed",
          targetAgentIds: ["agent-2"],
        }),
      );

      const second = new FileBackedMissionRepository({ filePath });

      const loaded = await second.getById("mission-1");
      expect(loaded?.status).toBe("InProgress");
      expect(loaded?.claimedBy).toBe("agent-1");

      const pageOne = await second.query({ issuerId: "issuer-1" }, { limit: 1 });
      expect(pageOne.items.length).toBe(1);
      expect(pageOne.items[0]?.id).toBe("mission-1");
      expect(pageOne.nextCursor).toBeUndefined();

      const filtered = await second.query(
        {
          status: "Failed",
          targetAgentId: "agent-2",
        },
        { limit: 10 },
      );
      expect(filtered.items.length).toBe(1);
      expect(filtered.items[0]?.id).toBe("mission-2");

      const replay = await second.replay({ fromOffset: 0, limit: 10 });
      expect(replay.entries.length).toBe(3);
      expect(replay.entries[0]?.action).toBe("created");
      expect(replay.entries[1]?.action).toBe("updated");
      expect(replay.entries[2]?.action).toBe("created");
      expect(replay.entries[1]?.status).toBe("InProgress");

      const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
        missions: unknown[];
        lifecycle: unknown[];
      };
      expect(Array.isArray(persisted.missions)).toBe(true);
      expect(Array.isArray(persisted.lifecycle)).toBe(true);
      expect(persisted.missions.length).toBe(2);
      expect(persisted.lifecycle.length).toBe(3);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses file-backed mission storage when PACT_MISSION_STORE_FILE is configured", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pact-mission-store-env-"));
    const filePath = join(directory, "missions.json");

    try {
      const firstContainer = createContainer(undefined, {
        env: {
          PACT_MISSION_STORE_FILE: filePath,
        },
      });

      await firstContainer.pactID.registerParticipant({
        id: "issuer-1",
        role: "issuer",
        displayName: "Issuer",
        skills: [],
        location: { latitude: 0, longitude: 0 },
      });

      const created = await firstContainer.pactMissions.createMission({
        issuerId: "issuer-1",
        title: "Persistent mission",
        budgetCents: 1234,
        context: {
          objective: "persist mission",
          constraints: ["none"],
          successCriteria: ["exists on reload"],
        },
      });

      const secondContainer = createContainer(undefined, {
        env: {
          PACT_MISSION_STORE_FILE: filePath,
        },
      });

      const missions = await secondContainer.pactMissions.listMissions();
      expect(missions.length).toBe(1);
      expect(missions[0]?.id).toBe(created.id);
      expect(missions[0]?.title).toBe("Persistent mission");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
