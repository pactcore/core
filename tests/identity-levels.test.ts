import { describe, expect, test } from "bun:test";
import { PactID } from "../src/application/modules/pact-id";
import { determineLevel, getLevelBenefits } from "../src/domain/identity-levels";
import type { ParticipantStats } from "../src/domain/types";
import { InMemoryCredentialIssuer } from "../src/infrastructure/identity/in-memory-credential-issuer";
import { InMemoryCredentialRepository } from "../src/infrastructure/identity/in-memory-credential-repository";
import { InMemoryDIDRepository } from "../src/infrastructure/identity/in-memory-did-repository";
import { InMemoryParticipantStatsRepository } from "../src/infrastructure/identity/in-memory-participant-stats-repository";
import { InMemoryParticipantRepository } from "../src/infrastructure/repositories/in-memory-participant-repository";
import { InMemoryReputationRepository } from "../src/infrastructure/repositories/in-memory-reputation-repository";
import { InMemoryWorkerRepository } from "../src/infrastructure/repositories/in-memory-worker-repository";
import { InMemoryReputationService } from "../src/infrastructure/reputation/in-memory-reputation-service";

function buildStats(
  participantId: string,
  overrides: Partial<ParticipantStats> = {},
): ParticipantStats {
  return {
    participantId,
    taskCount: 0,
    completedTaskCount: 0,
    reputation: 0,
    hasZKProofOfHumanity: false,
    hasPhoneVerification: false,
    hasIdVerification: false,
    ...overrides,
  };
}

function setup() {
  const participantRepository = new InMemoryParticipantRepository();
  const workerRepository = new InMemoryWorkerRepository();
  const reputationRepository = new InMemoryReputationRepository();
  const reputationService = new InMemoryReputationService(reputationRepository);
  const didRepository = new InMemoryDIDRepository();
  const credentialIssuer = new InMemoryCredentialIssuer("identity-level-test-secret");
  const credentialRepository = new InMemoryCredentialRepository();
  const participantStatsRepository = new InMemoryParticipantStatsRepository();

  const pactID = new PactID(
    participantRepository,
    workerRepository,
    reputationService,
    didRepository,
    credentialIssuer,
    credentialRepository,
    participantStatsRepository,
  );

  return { pactID, participantStatsRepository };
}

describe("Identity Levels", () => {
  test("determineLevel returns basic for new participant", () => {
    expect(
      determineLevel({
        taskCount: 0,
        reputation: 0,
        hasZKProof: false,
        hasPhoneVerification: false,
        hasIdVerification: false,
      }),
    ).toBe("basic");
  });

  test("determineLevel returns verified with phone+id verification", () => {
    expect(
      determineLevel({
        taskCount: 1,
        reputation: 50,
        hasZKProof: false,
        hasPhoneVerification: true,
        hasIdVerification: true,
      }),
    ).toBe("verified");
  });

  test("determineLevel returns trusted with ZK proof", () => {
    expect(
      determineLevel({
        taskCount: 1,
        reputation: 50,
        hasZKProof: true,
        hasPhoneVerification: false,
        hasIdVerification: false,
      }),
    ).toBe("trusted");
  });

  test("determineLevel returns elite with 100+ tasks and 95+ reputation", () => {
    expect(
      determineLevel({
        taskCount: 100,
        reputation: 95,
        hasZKProof: false,
        hasPhoneVerification: false,
        hasIdVerification: false,
      }),
    ).toBe("elite");
  });

  test("level benefits are correct for each tier", () => {
    expect(getLevelBenefits("basic")).toEqual({
      level: "basic",
      maxConcurrentTasks: 1,
      feeDiscountBps: 0,
      canAccessPremiumTasks: false,
      taskPayoutMultiplierBps: 10_000,
    });
    expect(getLevelBenefits("verified")).toEqual({
      level: "verified",
      maxConcurrentTasks: 3,
      feeDiscountBps: 250,
      canAccessPremiumTasks: false,
      taskPayoutMultiplierBps: 10_250,
    });
    expect(getLevelBenefits("trusted")).toEqual({
      level: "trusted",
      maxConcurrentTasks: 5,
      feeDiscountBps: 500,
      canAccessPremiumTasks: true,
      taskPayoutMultiplierBps: 10_500,
    });
    expect(getLevelBenefits("elite")).toEqual({
      level: "elite",
      maxConcurrentTasks: 10,
      feeDiscountBps: 1_000,
      canAccessPremiumTasks: true,
      taskPayoutMultiplierBps: 11_500,
    });
  });

  test("registerParticipant initializes basic level and zero stats", async () => {
    const { pactID } = setup();
    const participant = await pactID.registerParticipant({
      id: "participant-init",
      role: "agent",
      displayName: "Participant Init",
    });

    expect(participant.identityLevel).toBe("basic");
    expect(participant.stats).toBeDefined();
    expect(participant.stats?.taskCount).toBe(0);
    expect(participant.stats?.completedTaskCount).toBe(0);
    expect(participant.stats?.reputation).toBe(0);
  });

  test("recordTaskCompletion increments count", async () => {
    const { pactID } = setup();
    await pactID.registerParticipant({
      id: "participant-task",
      role: "worker",
      displayName: "Task Worker",
    });

    const statsAfterFirst = await pactID.recordTaskCompletion("participant-task");
    const statsAfterSecond = await pactID.recordTaskCompletion("participant-task");

    expect(statsAfterFirst.taskCount).toBe(1);
    expect(statsAfterSecond.taskCount).toBe(2);
    expect(statsAfterSecond.completedTaskCount).toBe(2);
  });

  test("upgradeIdentityLevel transitions correctly", async () => {
    const { pactID, participantStatsRepository } = setup();
    await pactID.registerParticipant({
      id: "participant-upgrade",
      role: "worker",
      displayName: "Upgrade Worker",
    });

    await participantStatsRepository.save(
      buildStats("participant-upgrade", {
        hasPhoneVerification: true,
        hasIdVerification: true,
      }),
    );

    const toVerified = await pactID.upgradeIdentityLevel("participant-upgrade");
    expect(toVerified.previousLevel).toBe("basic");
    expect(toVerified.newLevel).toBe("verified");
    expect(toVerified.participant.identityLevel).toBe("verified");

    await participantStatsRepository.save(
      buildStats("participant-upgrade", {
        hasPhoneVerification: true,
        hasIdVerification: true,
        hasZKProofOfHumanity: true,
      }),
    );

    const toTrusted = await pactID.upgradeIdentityLevel("participant-upgrade");
    expect(toTrusted.previousLevel).toBe("verified");
    expect(toTrusted.newLevel).toBe("trusted");
  });

  test("getIdentityLevel returns tier from participant stats", async () => {
    const { pactID, participantStatsRepository } = setup();
    await pactID.registerParticipant({
      id: "participant-level",
      role: "agent",
      displayName: "Level Agent",
    });

    await participantStatsRepository.save(
      buildStats("participant-level", {
        taskCount: 100,
        completedTaskCount: 100,
        reputation: 97,
      }),
    );

    expect(await pactID.getIdentityLevel("participant-level")).toBe("elite");
  });
});
