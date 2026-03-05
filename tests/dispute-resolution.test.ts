import { describe, expect, it } from "bun:test";
import { createApp } from "../src/api/app";
import { createContainer } from "../src/application/container";

async function setupDisputeFixture() {
  const container = createContainer();

  await container.pactID.registerParticipant({
    id: "issuer-1",
    role: "issuer",
    displayName: "Issuer One",
    skills: [],
    initialReputation: 80,
    location: { latitude: 0, longitude: 0 },
  });

  await container.pactID.registerParticipant({
    id: "agent-1",
    role: "agent",
    displayName: "Agent One",
    skills: ["vision"],
    initialReputation: 82,
    location: { latitude: 0, longitude: 0 },
  });

  await container.pactID.registerParticipant({
    id: "validator-1",
    role: "validator",
    displayName: "Validator One",
    skills: ["audit"],
    initialReputation: 91,
    location: { latitude: 0, longitude: 0 },
  });

  await container.pactID.registerParticipant({
    id: "validator-2",
    role: "validator",
    displayName: "Validator Two",
    skills: ["audit"],
    initialReputation: 88,
    location: { latitude: 0, longitude: 0 },
  });

  await container.pactID.registerParticipant({
    id: "jury-1",
    role: "jury",
    displayName: "Jury One",
    skills: ["dispute"],
    initialReputation: 95,
    location: { latitude: 0, longitude: 0 },
  });

  await container.pactID.registerParticipant({
    id: "jury-2",
    role: "jury",
    displayName: "Jury Two",
    skills: ["dispute"],
    initialReputation: 93,
    location: { latitude: 0, longitude: 0 },
  });

  await container.pactID.registerParticipant({
    id: "jury-3",
    role: "jury",
    displayName: "Jury Three",
    skills: ["dispute"],
    initialReputation: 90,
    location: { latitude: 0, longitude: 0 },
  });

  await container.pactID.registerParticipant({
    id: "jury-low",
    role: "jury",
    displayName: "Low Jury",
    skills: ["dispute"],
    initialReputation: 15,
    location: { latitude: 0, longitude: 0 },
  });

  const mission = await container.pactMissions.createMission({
    issuerId: "issuer-1",
    title: "Dispute-enabled mission",
    budgetCents: 20_000,
    targetAgentIds: ["agent-1"],
    context: {
      objective: "Collect shelf images",
      constraints: ["no pii"],
      successCriteria: ["at least 20 images"],
    },
  });

  await container.pactMissions.claimMission(mission.id, "agent-1");

  return { container, missionId: mission.id };
}

describe("Dispute resolution lifecycle", () => {
  it("opens a dispute with initial evidence", async () => {
    const { container, missionId } = await setupDisputeFixture();
    const dispute = await container.pactDisputes.openDispute(missionId, "validator-1", {
      description: "Initial contradiction found",
      artifactUris: ["ipfs://dispute-init"],
    });

    expect(dispute.status).toBe("open");
    expect(dispute.evidence).toHaveLength(1);
    expect(dispute.respondentId).toBe("agent-1");
  });

  it("accepts evidence submissions from dispute parties", async () => {
    const { container, missionId } = await setupDisputeFixture();
    const dispute = await container.pactDisputes.openDispute(missionId, "validator-1", {
      description: "Initial evidence",
      artifactUris: ["ipfs://seed-evidence"],
    });

    const updated = await container.pactDisputes.submitEvidence(dispute.id, "agent-1", {
      description: "Respondent counter evidence",
      artifactUris: ["ipfs://counter-evidence"],
    });

    expect(updated.status).toBe("evidence");
    expect(updated.evidence).toHaveLength(2);
    expect(updated.evidence[1]?.submitterId).toBe("agent-1");
  });

  it("rejects evidence submissions from non-parties", async () => {
    const { container, missionId } = await setupDisputeFixture();
    const dispute = await container.pactDisputes.openDispute(missionId, "validator-1", {
      description: "Initial evidence",
      artifactUris: ["ipfs://seed-evidence"],
    });

    await expect(
      container.pactDisputes.submitEvidence(dispute.id, "validator-2", {
        description: "Outsider input",
        artifactUris: ["ipfs://outsider"],
      }),
    ).rejects.toThrow("only dispute parties can submit evidence");
  });

  it("transitions to jury voting after evidence period closure", async () => {
    const { container, missionId } = await setupDisputeFixture();
    const dispute = await container.pactDisputes.openDispute(missionId, "validator-1", {
      description: "Initial evidence",
      artifactUris: ["ipfs://seed-evidence"],
    });

    const juryVoteReady = await container.pactDisputes.closeEvidencePeriod(dispute.id);
    expect(juryVoteReady.status).toBe("jury_vote");
  });

  it("rejects votes from non-jury participants", async () => {
    const { container, missionId } = await setupDisputeFixture();
    const dispute = await container.pactDisputes.openDispute(missionId, "validator-1", {
      description: "Initial evidence",
      artifactUris: ["ipfs://seed-evidence"],
    });
    await container.pactDisputes.closeEvidencePeriod(dispute.id);

    await expect(
      container.pactDisputes.castJuryVote(dispute.id, "validator-2", "uphold", "Not a juror"),
    ).rejects.toThrow("not eligible to vote as jury");
  });

  it("rejects votes from jurors below reputation threshold", async () => {
    const { container, missionId } = await setupDisputeFixture();
    const dispute = await container.pactDisputes.openDispute(missionId, "validator-1", {
      description: "Initial evidence",
      artifactUris: ["ipfs://seed-evidence"],
    });
    await container.pactDisputes.closeEvidencePeriod(dispute.id);

    await expect(
      container.pactDisputes.castJuryVote(dispute.id, "jury-low", "uphold", "Low reputation vote"),
    ).rejects.toThrow("below minimum");
  });

  it("auto-resolves the dispute when quorum is reached", async () => {
    const { container, missionId } = await setupDisputeFixture();
    const dispute = await container.pactDisputes.openDispute(missionId, "validator-1", {
      description: "Initial evidence",
      artifactUris: ["ipfs://seed-evidence"],
    });
    await container.pactDisputes.closeEvidencePeriod(dispute.id);

    const firstVote = await container.pactDisputes.castJuryVote(
      dispute.id,
      "jury-1",
      "uphold",
      "Evidence supports challenger",
    );
    expect(firstVote.status).toBe("jury_vote");

    const secondVote = await container.pactDisputes.castJuryVote(
      dispute.id,
      "jury-2",
      "uphold",
      "Strong contradiction in logs",
    );
    expect(secondVote.status).toBe("jury_vote");

    const resolved = await container.pactDisputes.castJuryVote(
      dispute.id,
      "jury-3",
      "reject",
      "Minor procedural issue",
    );
    expect(resolved.status).toBe("resolved");
    expect(resolved.verdict?.outcome).toBe("upheld");
    expect(resolved.resolvedAt).toBeDefined();
    expect(Object.keys(resolved.verdict?.rewardDistribution ?? {}).sort()).toEqual([
      "jury-1",
      "jury-2",
    ]);
  });

  it("prevents manual resolution before quorum or voting timeout", async () => {
    const { container, missionId } = await setupDisputeFixture();
    const dispute = await container.pactDisputes.openDispute(missionId, "validator-1", {
      description: "Initial evidence",
      artifactUris: ["ipfs://seed-evidence"],
    });
    await container.pactDisputes.closeEvidencePeriod(dispute.id);
    await container.pactDisputes.castJuryVote(
      dispute.id,
      "jury-1",
      "uphold",
      "Single vote is not quorum",
    );

    await expect(container.pactDisputes.resolveDispute(dispute.id)).rejects.toThrow(
      "cannot be resolved before quorum or voting timeout",
    );
  });

  it("lists disputes by status filter", async () => {
    const { container, missionId } = await setupDisputeFixture();

    const openDispute = await container.pactDisputes.openDispute(missionId, "validator-1", {
      description: "Open dispute",
      artifactUris: ["ipfs://open"],
    });

    const voteDispute = await container.pactDisputes.openDispute(missionId, "validator-1", {
      description: "Vote dispute",
      artifactUris: ["ipfs://vote"],
    });
    await container.pactDisputes.closeEvidencePeriod(voteDispute.id);

    const openOnly = await container.pactDisputes.listDisputes("open");
    const juryOnly = await container.pactDisputes.listDisputes("jury_vote");
    const all = await container.pactDisputes.listDisputes();

    expect(openOnly).toHaveLength(1);
    expect(openOnly[0]?.id).toBe(openDispute.id);
    expect(juryOnly).toHaveLength(1);
    expect(juryOnly[0]?.id).toBe(voteDispute.id);
    expect(all).toHaveLength(2);
  });
});

describe("Dispute API routes", () => {
  it("serves list endpoint and validates dispute status filters", async () => {
    const app = createApp();

    const list = await app.request("/disputes");
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([]);

    const invalidStatus = await app.request("/disputes?status=invalid");
    expect(invalidStatus.status).toBe(400);
  });
});
