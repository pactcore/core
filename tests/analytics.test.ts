import { describe, expect, it } from "bun:test";
import { createApp } from "../src/api/app";
import { createContainer } from "../src/application/container";

function buildTaskConstraints(requiredSkills: string[]) {
  return {
    requiredSkills,
    maxDistanceKm: 100,
    minReputation: 0,
    capacityRequired: 1,
  };
}

function buildTaskEvidence(autoAIScore: number) {
  return {
    summary: `evidence-${autoAIScore}`,
    artifactUris: ["ipfs://artifact"],
    submittedAt: Date.now(),
    validation: {
      autoAIScore,
      agentVotes: [],
      humanVotes: [],
    },
  };
}

async function registerCoreParticipants() {
  const container = createContainer();

  await container.pactID.registerParticipant({
    id: "issuer-1",
    role: "issuer",
    displayName: "Issuer 1",
  });
  await container.pactID.registerParticipant({
    id: "worker-1",
    role: "worker",
    displayName: "Worker 1",
    skills: ["image", "audio", "general"],
  });
  await container.pactID.registerParticipant({
    id: "validator-1",
    role: "validator",
    displayName: "Validator 1",
  });
  await container.pactID.registerParticipant({
    id: "agent-1",
    role: "agent",
    displayName: "Agent 1",
  });

  return container;
}

describe("PactAnalytics module", () => {
  it("aggregates network stats across participants, tasks, compute, and data", async () => {
    const container = await registerCoreParticipants();

    await container.pactCompute.registerProvider({
      id: "provider-available",
      name: "Available Provider",
      capabilities: { cpuCores: 4, memoryMB: 8_192, gpuCount: 0 },
      pricePerCpuSecondCents: 1,
      pricePerGpuSecondCents: 2,
      pricePerMemoryMBHourCents: 1,
      status: "available",
      registeredAt: Date.now(),
    });
    await container.pactCompute.registerProvider({
      id: "provider-offline",
      name: "Offline Provider",
      capabilities: { cpuCores: 8, memoryMB: 16_384, gpuCount: 1 },
      pricePerCpuSecondCents: 2,
      pricePerGpuSecondCents: 3,
      pricePerMemoryMBHourCents: 2,
      status: "offline",
      registeredAt: Date.now(),
    });

    await container.pactData.publish({
      ownerId: "issuer-1",
      title: "Road Camera Feed",
      uri: "ipfs://asset-1",
      tags: ["vision"],
    });

    await container.pactTasks.createTask({
      title: "Collect sample",
      description: "Collect one sample",
      issuerId: "issuer-1",
      paymentCents: 500,
      location: { latitude: 0, longitude: 0 },
      constraints: buildTaskConstraints(["image"]),
    });

    const stats = await container.pactAnalytics.getNetworkStats();
    expect(stats.totalParticipants).toBe(4);
    expect(stats.totalTasks).toBe(1);
    expect(stats.activeComputeProviders).toBe(1);
    expect(stats.dataAssetsCount).toBe(1);
    expect(stats.avgReputation).toBeGreaterThan(0);
  });

  it("computes task analytics for created/completed/failed flows", async () => {
    const container = await registerCoreParticipants();

    const completedTask = await container.pactTasks.createTask({
      title: "Classify image",
      description: "Classify one image",
      issuerId: "issuer-1",
      paymentCents: 900,
      location: { latitude: 0, longitude: 0 },
      constraints: buildTaskConstraints(["image"]),
    });
    await container.pactTasks.assignTask(completedTask.id, "worker-1");
    await container.pactTasks.submitEvidence(completedTask.id, buildTaskEvidence(0.95));

    const failedTask = await container.pactTasks.createTask({
      title: "Transcribe audio",
      description: "Transcribe one clip",
      issuerId: "issuer-1",
      paymentCents: 600,
      location: { latitude: 0, longitude: 0 },
      constraints: buildTaskConstraints(["audio"]),
    });
    await container.pactTasks.assignTask(failedTask.id, "worker-1");
    await container.pactTasks.submitEvidence(failedTask.id, buildTaskEvidence(0.2));

    const analytics = await container.pactAnalytics.getTaskAnalytics("day");
    expect(analytics.created).toBe(2);
    expect(analytics.completed).toBe(1);
    expect(analytics.failed).toBe(1);
    expect(analytics.avgCompletionTimeMs).toBeGreaterThanOrEqual(0);
    expect(analytics.topCategories.some((entry) => entry.category === "image")).toBeTrue();
  });

  it("computes economic analytics with module revenue and top earners", async () => {
    const container = await registerCoreParticipants();

    await container.pactPay.routePayment("payer-1", "earner-1", 700, "USD_CENTS", "invoice-1");
    await container.pactPay.routePayment("payer-1", "earner-2", 300, "USD_CENTS", "invoice-2");
    await container.pactPay.routePayment("payer-1", "earner-3", 0, "USD_CENTS", "invoice-invalid");

    const asset = await container.pactData.publish({
      ownerId: "issuer-1",
      title: "Dataset",
      uri: "ipfs://asset-2",
      tags: ["dataset"],
    });
    const listing = await container.pactData.listAsset(asset.id, 400, "other");
    await container.pactData.purchaseAsset(listing.id, "buyer-1");

    const analytics = await container.pactAnalytics.getEconomicAnalytics();
    expect(analytics.totalSettled).toBe(1_400);
    expect(analytics.avgPaymentCents).toBeGreaterThan(0);
    expect(analytics.topEarners[0]?.participantId).toBe("earner-1");
    expect(analytics.revenueByModule.some((entry) => entry.module === "pact-pay")).toBeTrue();
    expect(analytics.revenueByModule.some((entry) => entry.module === "pact-data")).toBeTrue();
  });

  it("computes security analytics for spam, disputes, and mission challenges", async () => {
    const container = await registerCoreParticipants();

    await container.pactAntiSpam.recordAction("issuer-1", "task_creation");

    const mission = await container.pactMissions.createMission({
      issuerId: "issuer-1",
      title: "Audit mission",
      budgetCents: 2_000,
      context: {
        objective: "Audit a report",
        constraints: [],
        successCriteria: ["accurate"],
      },
    });

    await container.pactMissions.claimMission(mission.id, "agent-1");
    await container.pactMissions.appendExecutionStep({
      missionId: mission.id,
      agentId: "agent-1",
      kind: "decision",
      summary: "Initial decision",
    });
    await container.pactMissions.submitEvidenceBundle({
      missionId: mission.id,
      agentId: "agent-1",
      summary: "Evidence bundle",
      artifactUris: ["ipfs://bundle-1"],
      bundleHash: "hash-bundle-1",
    });
    await container.pactMissions.recordVerdict({
      missionId: mission.id,
      reviewerId: "validator-1",
      approve: true,
      confidence: 0.2,
      notes: "Low confidence triggers escalation",
    });

    await container.pactDisputes.openDispute(mission.id, "validator-1", {
      description: "Evidence mismatch",
      artifactUris: ["ipfs://evidence-1"],
    });

    const analytics = await container.pactAnalytics.getSecurityAnalytics();
    expect(analytics.spamBlockedCount).toBeGreaterThanOrEqual(1);
    expect(analytics.disputeCount).toBe(1);
    expect(analytics.challengeCount).toBe(1);
    expect(analytics.avgSpamScore).toBeGreaterThanOrEqual(0);
  });
});

describe("Analytics API routes", () => {
  it("exposes /analytics/network with aggregated values", async () => {
    const app = createApp();

    await app.request("/id/participants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "issuer-route",
        role: "issuer",
        displayName: "Issuer Route",
      }),
    });
    await app.request("/id/participants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "worker-route",
        role: "worker",
        displayName: "Worker Route",
        skills: ["image"],
      }),
    });

    await app.request("/compute/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "provider-route",
        name: "Provider Route",
        capabilities: { cpuCores: 4, memoryMB: 8192, gpuCount: 0 },
        pricePerCpuSecondCents: 1,
        pricePerGpuSecondCents: 2,
        pricePerMemoryMBHourCents: 1,
        status: "available",
      }),
    });

    await app.request("/data/assets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "issuer-route",
        title: "Route Asset",
        uri: "ipfs://route-asset",
      }),
    });

    await app.request("/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Route Task",
        description: "Task for network analytics route",
        issuerId: "issuer-route",
        paymentCents: 500,
        location: { latitude: 0, longitude: 0 },
        constraints: buildTaskConstraints(["image"]),
      }),
    });

    const response = await app.request("/analytics/network");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      totalParticipants: number;
      totalTasks: number;
      activeComputeProviders: number;
      dataAssetsCount: number;
    };

    expect(body.totalParticipants).toBe(2);
    expect(body.totalTasks).toBe(1);
    expect(body.activeComputeProviders).toBe(1);
    expect(body.dataAssetsCount).toBe(1);
  });

  it("supports /analytics/tasks and validates the period query", async () => {
    const app = createApp();

    const createTaskResponse = await app.request("/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Task Analytics Route",
        description: "Task for day period",
        issuerId: "issuer-route-2",
        paymentCents: 450,
        location: { latitude: 0, longitude: 0 },
        constraints: buildTaskConstraints(["general"]),
      }),
    });
    expect(createTaskResponse.status).toBe(201);

    const defaultPeriodResponse = await app.request("/analytics/tasks");
    expect(defaultPeriodResponse.status).toBe(200);
    const analytics = (await defaultPeriodResponse.json()) as {
      created: number;
    };
    expect(analytics.created).toBeGreaterThanOrEqual(1);

    const invalidPeriodResponse = await app.request("/analytics/tasks?period=month");
    expect(invalidPeriodResponse.status).toBe(400);
  });

  it("exposes /analytics/economics and /analytics/security", async () => {
    const app = createApp();

    const economicsResponse = await app.request("/analytics/economics");
    expect(economicsResponse.status).toBe(200);
    const economics = (await economicsResponse.json()) as {
      totalSettled: number;
      avgPaymentCents: number;
      revenueByModule: unknown[];
    };
    expect(economics.totalSettled).toBeGreaterThanOrEqual(0);
    expect(economics.avgPaymentCents).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(economics.revenueByModule)).toBeTrue();

    const securityResponse = await app.request("/analytics/security");
    expect(securityResponse.status).toBe(200);
    const security = (await securityResponse.json()) as {
      spamBlockedCount: number;
      disputeCount: number;
      challengeCount: number;
      avgSpamScore: number;
    };
    expect(security.spamBlockedCount).toBeGreaterThanOrEqual(0);
    expect(security.disputeCount).toBeGreaterThanOrEqual(0);
    expect(security.challengeCount).toBeGreaterThanOrEqual(0);
    expect(security.avgSpamScore).toBeGreaterThanOrEqual(0);
  });
});
