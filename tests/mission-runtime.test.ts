import { describe, expect, it } from "bun:test";
import { createContainer } from "../src/application/container";

describe("Agent-native mission runtime", () => {
  it("supports mission inbox -> claim -> execute -> evidence -> verdict with event replay", async () => {
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
      displayName: "Worker Agent",
      skills: ["vision", "classification"],
      location: { latitude: 0, longitude: 0 },
    });

    await container.pactID.registerParticipant({
      id: "validator-1",
      role: "validator",
      displayName: "Validator",
      skills: ["audit"],
      location: { latitude: 0, longitude: 0 },
    });

    const mission = await container.pactMissions.createMission({
      issuerId: "issuer-1",
      title: "Classify storefront imagery",
      budgetCents: 15000,
      targetAgentIds: ["agent-1"],
      context: {
        objective: "Produce class labels for storefront photos",
        constraints: ["No PII", "Deterministic prompt"],
        successCriteria: [">=95% label consistency", "hash all outputs"],
      },
    });

    const inbox = await container.agentMailbox.pullInbox("agent-1");
    expect(inbox.length).toBe(1);
    expect(inbox[0]?.topic).toBe("mission.available");

    const claimed = await container.pactMissions.claimMission(mission.id, "agent-1");
    expect(claimed.status).toBe("Claimed");

    const step = await container.pactMissions.appendExecutionStep({
      missionId: mission.id,
      agentId: "agent-1",
      kind: "tool_call",
      summary: "Run image feature extraction",
      inputHash: "sha256:input",
      outputHash: "sha256:features",
    });

    expect(step.agentId).toBe("agent-1");

    const evidence = await container.pactMissions.submitEvidenceBundle({
      missionId: mission.id,
      agentId: "agent-1",
      summary: "Completed labeling and confidence export",
      artifactUris: ["ipfs://bundle-1"],
      bundleHash: "sha256:bundle",
      stepId: step.id,
    });

    expect(evidence.missionId).toBe(mission.id);

    const verdict = await container.pactMissions.recordVerdict({
      missionId: mission.id,
      reviewerId: "validator-1",
      approve: true,
      confidence: 0.91,
      notes: "High consistency, no policy violations",
    });

    expect(verdict.approve).toBeTrue();

    const finalMission = await container.pactMissions.getMission(mission.id);
    expect(finalMission.status).toBe("Settled");

    const replay = await container.eventJournal.replay();
    const names = replay.map((record) => record.event.name);
    expect(names).toContain("mission.created");
    expect(names).toContain("mission.claimed");
    expect(names).toContain("mission.execution_step_appended");
    expect(names).toContain("mission.evidence_submitted");
    expect(names).toContain("mission.verdict_recorded");
    expect(names).toContain("mission.settled");
  });
});
