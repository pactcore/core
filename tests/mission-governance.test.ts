import { describe, expect, it } from "bun:test";
import { createContainer } from "../src/application/container";

async function seedParticipants() {
  const container = createContainer();

  await container.pactID.registerParticipant({
    id: "issuer-1",
    role: "issuer",
    displayName: "Issuer",
    skills: [],
    location: { latitude: 0, longitude: 0 },
  });

  await container.pactID.registerParticipant({
    id: "agent-1",
    role: "agent",
    displayName: "Agent One",
    skills: ["vision"],
    location: { latitude: 0, longitude: 0 },
  });

  await container.pactID.registerParticipant({
    id: "validator-1",
    role: "validator",
    displayName: "Validator One",
    skills: ["audit"],
    location: { latitude: 0, longitude: 0 },
  });

  await container.pactID.registerParticipant({
    id: "validator-2",
    role: "validator",
    displayName: "Validator Two",
    skills: ["audit"],
    location: { latitude: 0, longitude: 0 },
  });

  await container.pactID.registerParticipant({
    id: "jury-1",
    role: "jury",
    displayName: "Jury",
    skills: ["dispute"],
    location: { latitude: 0, longitude: 0 },
  });

  return container;
}

describe("Mission governance and escalation", () => {
  it("retries failed missions within max retries", async () => {
    const container = await seedParticipants();

    const mission = await container.pactMissions.createMission({
      issuerId: "issuer-1",
      title: "Audit shelf tags",
      budgetCents: 9000,
      maxRetries: 2,
      targetAgentIds: ["agent-1"],
      context: {
        objective: "verify labels",
        constraints: ["no-manual edits"],
        successCriteria: ["hash outputs"],
      },
    });

    await container.pactMissions.claimMission(mission.id, "agent-1");
    await container.pactMissions.appendExecutionStep({
      missionId: mission.id,
      agentId: "agent-1",
      kind: "tool_call",
      summary: "run ocr",
    });
    await container.pactMissions.submitEvidenceBundle({
      missionId: mission.id,
      agentId: "agent-1",
      summary: "bundle",
      artifactUris: ["ipfs://bundle-a"],
      bundleHash: "sha256:a",
    });

    await container.pactMissions.recordVerdict({
      missionId: mission.id,
      reviewerId: "validator-1",
      approve: false,
      confidence: 0.9,
      notes: "evidence invalid",
    });

    const failed = await container.pactMissions.getMission(mission.id);
    expect(failed.status).toBe("Failed");

    const retried = await container.pactMissions.retryMission(mission.id, "first_retry");
    expect(retried.status).toBe("Open");
    expect(retried.retryCount).toBe(1);

    const inbox = await container.agentMailbox.pullInbox("agent-1");
    const hasRetryMessage = inbox.some((msg) => msg.topic === "mission.retry_available");
    expect(hasRetryMessage).toBeTrue();
  });

  it("posts challenge stake and returns it with penalty when challenge is upheld", async () => {
    const container = await seedParticipants();

    const mission = await container.pactMissions.createMission({
      issuerId: "issuer-1",
      title: "Store compliance check",
      budgetCents: 12000,
      targetAgentIds: ["agent-1"],
      context: {
        objective: "collect and classify shelf imagery",
        constraints: ["no pii"],
        successCriteria: ["consistency >= 90%"],
      },
    });

    await container.pactMissions.claimMission(mission.id, "agent-1");
    await container.pactMissions.appendExecutionStep({
      missionId: mission.id,
      agentId: "agent-1",
      kind: "tool_call",
      summary: "run classifier",
    });
    await container.pactMissions.submitEvidenceBundle({
      missionId: mission.id,
      agentId: "agent-1",
      summary: "classified",
      artifactUris: ["ipfs://bundle-b"],
      bundleHash: "sha256:b",
    });

    await container.pactMissions.recordVerdict({
      missionId: mission.id,
      reviewerId: "validator-1",
      approve: true,
      confidence: 0.6,
      notes: "needs human follow-up",
    });

    await container.pactMissions.recordVerdict({
      missionId: mission.id,
      reviewerId: "validator-2",
      approve: false,
      confidence: 0.9,
      notes: "model drift suspected",
      challengeStakeCents: 1_200,
    });

    const underReview = await container.pactMissions.getMission(mission.id);
    const openChallenge = underReview.challenges.find(
      (challenge) => challenge.status === "open" && challenge.challengerId === "validator-2",
    );
    expect(openChallenge).toBeDefined();

    if (!openChallenge) {
      throw new Error("Expected open challenge");
    }

    expect(openChallenge.stake.amountCents).toBe(1_200);
    expect(openChallenge.stake.status).toBe("posted");

    const beforeRecords = await container.pactEconomics.listSettlementRecords({
      settlementId: `challenge-${openChallenge.id}`,
    });
    expect(beforeRecords.length).toBe(1);
    expect(beforeRecords[0]?.legId).toBe("challenge-stake-posted");
    expect(beforeRecords[0]?.payerId).toBe("validator-2");
    expect(beforeRecords[0]?.payeeId).toBe("challenge:escrow");
    expect(beforeRecords[0]?.amount).toBe(1_200);

    const resolved = await container.pactMissions.resolveMissionChallenge({
      missionId: mission.id,
      challengeId: openChallenge.id,
      resolverId: "jury-1",
      approve: true,
      notes: "jury accepted challenger evidence",
    });

    expect(resolved.status).toBe("Settled");
    const resolvedChallenge = resolved.challenges.find((challenge) => challenge.id === openChallenge.id);
    expect(resolvedChallenge?.stake.status).toBe("returned");
    expect(resolvedChallenge?.stake.penalty?.payerId).toBe("validator-1");
    expect(resolvedChallenge?.stake.penalty?.payeeId).toBe("validator-2");
    expect(resolvedChallenge?.stake.penalty?.amountCents).toBe(240);

    const afterRecords = await container.pactEconomics.listSettlementRecords({
      settlementId: `challenge-${openChallenge.id}`,
    });

    expect(afterRecords.length).toBe(3);
    const legIds = afterRecords.map((record) => record.legId);
    expect(legIds).toContain("challenge-stake-posted");
    expect(legIds).toContain("challenge-stake-return");
    expect(legIds).toContain("challenge-upheld-penalty");
  });

  it("forfeits challenge stake and distributes to jury/protocol when challenge is rejected", async () => {
    const container = await seedParticipants();

    const mission = await container.pactMissions.createMission({
      issuerId: "issuer-1",
      title: "Reject frivolous challenge",
      budgetCents: 12000,
      targetAgentIds: ["agent-1"],
      context: {
        objective: "collect and classify shelf imagery",
        constraints: ["no pii"],
        successCriteria: ["consistency >= 90%"],
      },
    });

    await container.pactMissions.claimMission(mission.id, "agent-1");
    await container.pactMissions.appendExecutionStep({
      missionId: mission.id,
      agentId: "agent-1",
      kind: "tool_call",
      summary: "run classifier",
    });
    await container.pactMissions.submitEvidenceBundle({
      missionId: mission.id,
      agentId: "agent-1",
      summary: "classified",
      artifactUris: ["ipfs://bundle-c"],
      bundleHash: "sha256:c",
    });

    await container.pactMissions.recordVerdict({
      missionId: mission.id,
      reviewerId: "validator-1",
      approve: true,
      confidence: 0.6,
      notes: "uncertain",
    });

    await container.pactMissions.recordVerdict({
      missionId: mission.id,
      reviewerId: "validator-2",
      approve: false,
      confidence: 0.8,
      notes: "disagree",
      challengeStakeCents: 1_500,
    });

    const underReview = await container.pactMissions.getMission(mission.id);
    const openChallenge = underReview.challenges.find(
      (challenge) => challenge.status === "open" && challenge.challengerId === "validator-2",
    );
    expect(openChallenge).toBeDefined();

    if (!openChallenge) {
      throw new Error("Expected open challenge");
    }

    const resolved = await container.pactMissions.resolveMissionChallenge({
      missionId: mission.id,
      challengeId: openChallenge.id,
      resolverId: "jury-1",
      approve: false,
      notes: "challenge was frivolous",
    });

    expect(resolved.status).toBe("Failed");
    const resolvedChallenge = resolved.challenges.find((challenge) => challenge.id === openChallenge.id);
    expect(resolvedChallenge?.stake.status).toBe("forfeited");
    expect(resolvedChallenge?.stake.distribution?.juryRecipientId).toBe("jury-1");
    expect(resolvedChallenge?.stake.distribution?.protocolRecipientId).toBe("protocol:treasury");
    expect(resolvedChallenge?.stake.distribution?.juryAmountCents).toBe(1_050);
    expect(resolvedChallenge?.stake.distribution?.protocolAmountCents).toBe(450);

    const records = await container.pactEconomics.listSettlementRecords({
      settlementId: `challenge-${openChallenge.id}`,
    });

    expect(records.length).toBe(3);
    const forfeitureToJury = records.find((record) => record.legId === "challenge-stake-forfeit-jury");
    const forfeitureToProtocol = records.find(
      (record) => record.legId === "challenge-stake-forfeit-protocol",
    );

    expect(forfeitureToJury?.payeeId).toBe("jury-1");
    expect(forfeitureToJury?.amount).toBe(1_050);
    expect(forfeitureToProtocol?.payeeId).toBe("protocol:treasury");
    expect(forfeitureToProtocol?.amount).toBe(450);

    const replay = await container.eventJournal.replay();
    const names = replay.map((record) => record.event.name);
    expect(names).toContain("mission.challenge_opened");
    expect(names).toContain("mission.challenge_resolved");
    expect(names).toContain("mission.escalated");
  });
});
