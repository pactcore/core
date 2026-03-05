import { describe, expect, it } from "bun:test";
import { createApp } from "../src/api/app";

interface TaskResponse {
  id: string;
  status: string;
  assigneeId?: string;
  validatorIds: string[];
  evidence?: {
    artifactUris: string[];
  };
}

interface PaymentLedgerRow {
  to: string;
  amountCents: number;
  reference: string;
}

interface DataAssetResponse {
  id: string;
  ownerId: string;
  uri: string;
}

interface DataListingResponse {
  id: string;
  assetId: string;
}

interface DataPurchaseResponse {
  id: string;
  listingId: string;
  buyerId: string;
}

interface ZKProofResponse {
  id: string;
  type: string;
  verified: boolean;
}

interface ProvenanceEdgeResponse {
  childId: string;
  parentId: string;
}

interface ComputeJobResponse {
  id: string;
  topic: string;
}

interface ComputeResultResponse {
  jobId: string;
  providerId: string;
  status: string;
  usage: {
    jobId: string;
    providerId: string;
    totalCostCents: number;
  };
}

interface EventReplayResponse {
  records: Array<{
    offset: number;
    event: {
      name: string;
      payload: unknown;
    };
  }>;
}

interface MissionResponse {
  id: string;
  status: string;
  challenges: Array<{
    id: string;
    status: string;
    challengerId: string;
    stake: {
      status: string;
      distribution?: {
        juryAmountCents: number;
        protocolAmountCents: number;
        juryRecipientId: string;
        protocolRecipientId: string;
      };
    };
  }>;
}

interface SettlementRecordResponse {
  legId: string;
  amount: number;
  payeeId: string;
}

async function requestJson<T>(
  app: ReturnType<typeof createApp>,
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    expectedStatus?: number;
  } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const expectedStatus = options.expectedStatus ?? 200;
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  const response = await app.request(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body,
  });

  expect(response.status).toBe(expectedStatus);
  return (await response.json()) as T;
}

function amountTo(rows: PaymentLedgerRow[], recipientId: string): number {
  return rows
    .filter((row) => row.to === recipientId)
    .reduce((sum, row) => sum + row.amountCents, 0);
}

describe("Whitepaper §9 scenario-style e2e flows", () => {
  it('"Restaurant Review Agent" scenario', async () => {
    const app = createApp({
      autoAI: { enabled: true, passThreshold: 0.95 },
      agentValidators: { enabled: true, passThreshold: 1, requiredParticipants: 1 },
      humanJury: { enabled: false, passThreshold: 1, requiredParticipants: 1 },
    }, {
      rateLimit: { maxRequests: 10_000 },
      antiSpamEnabled: false,
    });

    await requestJson(app, "/id/participants", {
      method: "POST",
      expectedStatus: 201,
      body: {
        id: "restaurant-agent-1",
        role: "issuer",
        displayName: "Restaurant Review Agent",
        location: { latitude: 37.7749, longitude: -122.4194 },
      },
    });
    await requestJson(app, "/id/participants", {
      method: "POST",
      expectedStatus: 201,
      body: {
        id: "worker-human-1",
        role: "worker",
        displayName: "Human Worker",
        skills: ["photo", "gps"],
        capacity: 1,
        initialReputation: 95,
        location: { latitude: 37.775, longitude: -122.4195 },
      },
    });
    await requestJson(app, "/id/participants", {
      method: "POST",
      expectedStatus: 201,
      body: {
        id: "validator-1",
        role: "validator",
        displayName: "Validator One",
        location: { latitude: 37.7749, longitude: -122.4194 },
      },
    });

    const createdTask = await requestJson<TaskResponse>(app, "/tasks", {
      method: "POST",
      expectedStatus: 201,
      body: {
        title: "Food photo verification",
        description: "Capture and verify a meal photo with metadata",
        issuerId: "restaurant-agent-1",
        paymentCents: 10_000,
        location: { latitude: 37.7749, longitude: -122.4194 },
        constraints: {
          requiredSkills: ["photo", "gps"],
          maxDistanceKm: 5,
          minReputation: 70,
          capacityRequired: 1,
        },
      },
    });

    await requestJson<TaskResponse>(app, `/tasks/${createdTask.id}/assign`, {
      method: "POST",
      body: { workerId: "worker-human-1" },
    });

    const completedTask = await requestJson<TaskResponse>(app, `/tasks/${createdTask.id}/submit`, {
      method: "POST",
      body: {
        summary: "Photo captured at restaurant location",
        artifactUris: ["ipfs://food-proof/photo-001"],
        validation: {
          autoAIScore: 0.9,
          agentVotes: [{ participantId: "validator-1", approve: true }],
          humanVotes: [],
        },
      },
    });

    expect(completedTask.status).toBe("Completed");
    expect(completedTask.validatorIds).toEqual(["validator-1"]);
    const evidenceUri = completedTask.evidence?.artifactUris[0];
    expect(evidenceUri).toBeDefined();
    if (!evidenceUri) {
      throw new Error("expected evidence artifact URI");
    }

    const ledger = await requestJson<PaymentLedgerRow[]>(app, "/payments/ledger");
    const taskRows = ledger.filter((row) => row.reference === createdTask.id);
    expect(amountTo(taskRows, "worker-human-1")).toBe(8_500);
    expect(amountTo(taskRows, "validator-1")).toBe(500);
    expect(amountTo(taskRows, "restaurant-agent-1")).toBe(500);
    expect(amountTo(taskRows, "treasury")).toBe(500);

    const evidenceAsset = await requestJson<DataAssetResponse>(app, "/data/assets", {
      method: "POST",
      expectedStatus: 201,
      body: {
        ownerId: "worker-human-1",
        title: "Restaurant evidence asset",
        uri: evidenceUri,
        tags: ["restaurant", "food-photo", "task-evidence"],
      },
    });
    expect(evidenceAsset.uri).toBe(evidenceUri);

    const listing = await requestJson<DataListingResponse>(app, "/data/marketplace/list", {
      method: "POST",
      expectedStatus: 201,
      body: {
        assetId: evidenceAsset.id,
        priceCents: 2_400,
        category: "image_video",
      },
    });

    const purchase = await requestJson<DataPurchaseResponse>(app, "/data/marketplace/purchase", {
      method: "POST",
      expectedStatus: 201,
      body: {
        listingId: listing.id,
        buyerId: "restaurant-agent-1",
      },
    });
    expect(purchase.listingId).toBe(listing.id);
    expect(purchase.buyerId).toBe("restaurant-agent-1");

    const access = await requestJson<{ allowed: boolean }>(
      app,
      `/data/assets/${evidenceAsset.id}/access/restaurant-agent-1`,
    );
    expect(access.allowed).toBeTrue();
  });

  it('"Environmental Monitoring" scenario', async () => {
    const app = createApp(undefined, {
      rateLimit: { maxRequests: 10_000 },
      antiSpamEnabled: false,
    });

    await requestJson(app, "/id/participants", {
      method: "POST",
      expectedStatus: 201,
      body: {
        id: "monitoring-agent-1",
        role: "issuer",
        displayName: "Monitoring Agent",
        location: { latitude: 37.78, longitude: -122.42 },
      },
    });

    const workers = [
      { id: "field-worker-1", latitude: 37.781, longitude: -122.421 },
      { id: "field-worker-2", latitude: 37.782, longitude: -122.422 },
      { id: "field-worker-3", latitude: 37.783, longitude: -122.423 },
    ];

    for (const worker of workers) {
      await requestJson(app, "/id/participants", {
        method: "POST",
        expectedStatus: 201,
        body: {
          id: worker.id,
          role: "worker",
          displayName: worker.id,
          skills: ["sensor", "gps"],
          capacity: 2,
          initialReputation: 90,
          location: { latitude: worker.latitude, longitude: worker.longitude },
        },
      });
    }

    const completedTasks: TaskResponse[] = [];
    for (const worker of workers) {
      const task = await requestJson<TaskResponse>(app, "/tasks", {
        method: "POST",
        expectedStatus: 201,
        body: {
          title: `Sensor task ${worker.id}`,
          description: "Capture temperature + air quality + GPS",
          issuerId: "monitoring-agent-1",
          paymentCents: 4_000,
          location: { latitude: worker.latitude, longitude: worker.longitude },
          constraints: {
            requiredSkills: ["sensor", "gps"],
            maxDistanceKm: 10,
            minReputation: 70,
            capacityRequired: 1,
          },
        },
      });

      await requestJson<TaskResponse>(app, `/tasks/${task.id}/assign`, {
        method: "POST",
        body: { workerId: worker.id },
      });

      const completed = await requestJson<TaskResponse>(app, `/tasks/${task.id}/submit`, {
        method: "POST",
        body: {
          summary: `GPS + sensor payload from ${worker.id}`,
          artifactUris: [`ipfs://sensor/${worker.id}/raw.json`],
          validation: {
            autoAIScore: 0.95,
            agentVotes: [],
            humanVotes: [],
          },
        },
      });
      expect(completed.status).toBe("Completed");
      completedTasks.push(completed);
    }

    for (const worker of workers) {
      const proof = await requestJson<ZKProofResponse>(app, "/zk/proofs/location", {
        method: "POST",
        expectedStatus: 201,
        body: {
          proverId: worker.id,
          claim: {
            latitude: worker.latitude,
            longitude: worker.longitude,
            radius: 300,
            timestamp: Date.now(),
          },
        },
      });
      expect(proof.type).toBe("location");

      const verification = await requestJson<{ valid: boolean }>(
        app,
        `/zk/proofs/${proof.id}/verify`,
        {
          method: "POST",
        },
      );
      expect(verification.valid).toBeTrue();
    }

    const raw = await requestJson<DataAssetResponse>(app, "/data/assets", {
      method: "POST",
      expectedStatus: 201,
      body: {
        ownerId: "field-worker-1",
        title: "Raw sensor capture",
        uri: completedTasks[0]?.evidence?.artifactUris[0] ?? "ipfs://sensor/raw-fallback",
        tags: ["raw", "sensor", "gps"],
      },
    });
    const processed = await requestJson<DataAssetResponse>(app, "/data/assets", {
      method: "POST",
      expectedStatus: 201,
      body: {
        ownerId: "monitoring-agent-1",
        title: "Processed sensor dataset",
        uri: "ipfs://sensor/processed.csv",
        tags: ["processed", "sensor"],
        derivedFrom: [raw.id],
      },
    });
    const analysis = await requestJson<DataAssetResponse>(app, "/data/assets", {
      method: "POST",
      expectedStatus: 201,
      body: {
        ownerId: "monitoring-agent-1",
        title: "Environmental analysis report",
        uri: "ipfs://sensor/analysis.pdf",
        tags: ["analysis"],
        derivedFrom: [processed.id],
      },
    });

    const proofRaw = await requestJson<{ algorithm: string }>(
      app,
      `/data/assets/${raw.id}/integrity`,
      {
        method: "POST",
        expectedStatus: 201,
        body: { contentHash: "sha256:raw-001" },
      },
    );
    expect(proofRaw.algorithm).toBe("sha-256");

    await requestJson<{ valid: boolean }>(app, `/data/assets/${raw.id}/integrity/verify`, {
      method: "POST",
      body: { contentHash: "sha256:raw-001" },
    });
    const processedIntegrity = await requestJson<{ valid: boolean }>(
      app,
      `/data/assets/${processed.id}/integrity/verify`,
      {
        method: "POST",
        body: { contentHash: "sha256:processed-001" },
      },
    );
    expect(processedIntegrity.valid).toBe(false);

    await requestJson(app, `/data/assets/${processed.id}/integrity`, {
      method: "POST",
      expectedStatus: 201,
      body: { contentHash: "sha256:processed-001" },
    });
    await requestJson(app, `/data/assets/${analysis.id}/integrity`, {
      method: "POST",
      expectedStatus: 201,
      body: { contentHash: "sha256:analysis-001" },
    });

    const processedValid = await requestJson<{ valid: boolean }>(
      app,
      `/data/assets/${processed.id}/integrity/verify`,
      {
        method: "POST",
        body: { contentHash: "sha256:processed-001" },
      },
    );
    const analysisValid = await requestJson<{ valid: boolean }>(
      app,
      `/data/assets/${analysis.id}/integrity/verify`,
      {
        method: "POST",
        body: { contentHash: "sha256:analysis-001" },
      },
    );
    expect(processedValid.valid).toBeTrue();
    expect(analysisValid.valid).toBeTrue();

    const lineage = await requestJson<ProvenanceEdgeResponse[]>(
      app,
      `/data/assets/${analysis.id}/lineage`,
    );
    const parentIds = lineage.map((edge) => edge.parentId);
    expect(parentIds).toContain(processed.id);
    expect(parentIds).toContain(raw.id);
  });

  it('"Compute + Task hybrid" scenario', async () => {
    const app = createApp(undefined, {
      rateLimit: { maxRequests: 10_000 },
      antiSpamEnabled: false,
    });

    await requestJson(app, "/id/participants", {
      method: "POST",
      expectedStatus: 201,
      body: {
        id: "deploy-agent-1",
        role: "issuer",
        displayName: "Deploy Agent",
        location: { latitude: 40.7128, longitude: -74.006 },
      },
    });
    await requestJson(app, "/id/participants", {
      method: "POST",
      expectedStatus: 201,
      body: {
        id: "verification-worker-1",
        role: "worker",
        displayName: "Verification Worker",
        skills: ["verification"],
        capacity: 1,
        initialReputation: 88,
        location: { latitude: 40.713, longitude: -74.0061 },
      },
    });

    await requestJson(app, "/compute/providers", {
      method: "POST",
      expectedStatus: 201,
      body: {
        id: "compute-provider-1",
        name: "Serverless Provider",
        capabilities: {
          cpuCores: 16,
          memoryMB: 32768,
          gpuCount: 1,
          gpuModel: "A100",
        },
        pricePerCpuSecondCents: 1,
        pricePerGpuSecondCents: 5,
        pricePerMemoryMBHourCents: 2,
        status: "available",
      },
    });

    const job = await requestJson<ComputeJobResponse>(app, "/compute/jobs", {
      method: "POST",
      expectedStatus: 201,
      body: {
        image: "node:22",
        command: "node handler.js --event payload.json",
        metadata: {
          style: "serverless",
          function: "verify-menu-photo",
        },
      },
    });
    expect(job.topic).toBe("compute.exec");

    const result = await requestJson<ComputeResultResponse>(
      app,
      `/compute/jobs/${job.id}/dispatch`,
      {
        method: "POST",
        body: { providerId: "compute-provider-1" },
      },
    );
    expect(result.jobId).toBe(job.id);
    expect(result.providerId).toBe("compute-provider-1");
    expect(result.status).toBe("completed");
    expect(result.usage.totalCostCents).toBeGreaterThan(0);

    const usageRecords = await requestJson<Array<{ jobId: string; providerId: string }>>(
      app,
      `/compute/usage?jobId=${job.id}`,
    );
    expect(usageRecords).toHaveLength(1);
    expect(usageRecords[0]?.providerId).toBe("compute-provider-1");

    const verifyTask = await requestJson<TaskResponse>(app, "/tasks", {
      method: "POST",
      expectedStatus: 201,
      body: {
        title: "Verify compute output",
        description: "Use compute output in downstream verification",
        issuerId: "deploy-agent-1",
        paymentCents: 6_000,
        location: { latitude: 40.7128, longitude: -74.006 },
        constraints: {
          requiredSkills: ["verification"],
          maxDistanceKm: 20,
          minReputation: 60,
          capacityRequired: 1,
        },
      },
    });

    await requestJson<TaskResponse>(app, `/tasks/${verifyTask.id}/assign`, {
      method: "POST",
      body: { workerId: "verification-worker-1" },
    });

    const finalTask = await requestJson<TaskResponse>(app, `/tasks/${verifyTask.id}/submit`, {
      method: "POST",
      body: {
        summary: `Verified output for compute job ${job.id}`,
        artifactUris: [`compute://${job.id}/output.json`],
        validation: {
          autoAIScore: 0.93,
          agentVotes: [],
          humanVotes: [],
        },
      },
    });
    expect(finalTask.status).toBe("Completed");

    const replay = await requestJson<EventReplayResponse>(app, "/events/replay?fromOffset=0&limit=200");
    const names = replay.records.map((record) => record.event.name);
    const createdIndex = names.indexOf("task.created");
    const assignedIndex = names.indexOf("task.assigned");
    const submittedIndex = names.indexOf("task.submitted");
    const verifiedIndex = names.indexOf("task.verified");
    const completedIndex = names.indexOf("task.completed");

    expect(createdIndex).toBeGreaterThanOrEqual(0);
    expect(assignedIndex).toBeGreaterThan(createdIndex);
    expect(submittedIndex).toBeGreaterThan(assignedIndex);
    expect(verifiedIndex).toBeGreaterThan(submittedIndex);
    expect(completedIndex).toBeGreaterThan(verifiedIndex);
  });

  it('"Multi-party dispute" scenario', async () => {
    const app = createApp(undefined, {
      rateLimit: { maxRequests: 10_000 },
      antiSpamEnabled: false,
    });

    await requestJson(app, "/id/participants", {
      method: "POST",
      expectedStatus: 201,
      body: {
        id: "issuer-1",
        role: "issuer",
        displayName: "Issuing Agent",
        location: { latitude: 0, longitude: 0 },
      },
    });
    await requestJson(app, "/id/participants", {
      method: "POST",
      expectedStatus: 201,
      body: {
        id: "agent-1",
        role: "agent",
        displayName: "Executing Agent",
        skills: ["vision"],
        location: { latitude: 0, longitude: 0 },
      },
    });
    await requestJson(app, "/id/participants", {
      method: "POST",
      expectedStatus: 201,
      body: {
        id: "jury-1",
        role: "jury",
        displayName: "Jury Member",
        skills: ["dispute"],
        location: { latitude: 0, longitude: 0 },
      },
    });

    const mission = await requestJson<MissionResponse>(app, "/missions", {
      method: "POST",
      expectedStatus: 201,
      body: {
        issuerId: "issuer-1",
        title: "Shelf compliance review",
        budgetCents: 12_000,
        targetAgentIds: ["agent-1"],
        context: {
          objective: "verify shelf labels",
          constraints: ["no pii"],
          successCriteria: ["consistency >= 90%"],
        },
      },
    });

    await requestJson(app, `/missions/${mission.id}/claim`, {
      method: "POST",
      body: { agentId: "agent-1" },
    });

    await requestJson(app, `/missions/${mission.id}/steps`, {
      method: "POST",
      expectedStatus: 201,
      body: {
        agentId: "agent-1",
        kind: "tool_call",
        summary: "Executed shelf OCR and product match",
      },
    });

    await requestJson(app, `/missions/${mission.id}/evidence`, {
      method: "POST",
      expectedStatus: 201,
      body: {
        agentId: "agent-1",
        summary: "Primary execution evidence",
        artifactUris: ["ipfs://mission/evidence/agent-primary"],
        bundleHash: "sha256:agent-primary",
      },
    });

    const challengedMission = await requestJson<MissionResponse>(app, `/missions/${mission.id}/challenges`, {
      method: "POST",
      expectedStatus: 201,
      body: {
        challengerId: "issuer-1",
        counterpartyId: "agent-1",
        reason: "manual_escalation",
        stakeAmountCents: 1_500,
        notes: "issuer submitted conflicting store evidence",
      },
    });

    const openChallenge = challengedMission.challenges.find(
      (challenge) => challenge.status === "open" && challenge.challengerId === "issuer-1",
    );
    expect(openChallenge).toBeDefined();
    if (!openChallenge) {
      throw new Error("expected open challenge");
    }

    await requestJson(app, `/missions/${mission.id}/evidence`, {
      method: "POST",
      expectedStatus: 201,
      body: {
        agentId: "agent-1",
        summary: "Counter-evidence from agent side",
        artifactUris: ["ipfs://mission/evidence/agent-counter"],
        bundleHash: "sha256:agent-counter",
      },
    });

    const resolvedMission = await requestJson<MissionResponse>(
      app,
      `/missions/${mission.id}/challenges/${openChallenge.id}/resolve`,
      {
        method: "POST",
        body: {
          resolverId: "jury-1",
          approve: false,
          notes: "jury rejected challenge after reviewing both sides",
        },
      },
    );

    expect(resolvedMission.status).toBe("Failed");
    const resolvedChallenge = resolvedMission.challenges.find(
      (challenge) => challenge.id === openChallenge.id,
    );
    expect(resolvedChallenge?.stake.status).toBe("forfeited");
    expect(resolvedChallenge?.stake.distribution?.juryAmountCents).toBe(1_050);
    expect(resolvedChallenge?.stake.distribution?.protocolAmountCents).toBe(450);
    expect(resolvedChallenge?.stake.distribution?.juryRecipientId).toBe("jury-1");
    expect(resolvedChallenge?.stake.distribution?.protocolRecipientId).toBe("protocol:treasury");

    const records = await requestJson<SettlementRecordResponse[]>(
      app,
      `/economics/settlements/records?settlementId=challenge-${openChallenge.id}`,
    );
    const legIds = records.map((record) => record.legId);
    expect(legIds).toContain("challenge-stake-posted");
    expect(legIds).toContain("challenge-stake-forfeit-jury");
    expect(legIds).toContain("challenge-stake-forfeit-protocol");

    const forfeitureToJury = records.find((record) => record.legId === "challenge-stake-forfeit-jury");
    const forfeitureToProtocol = records.find(
      (record) => record.legId === "challenge-stake-forfeit-protocol",
    );
    expect(forfeitureToJury?.amount).toBe(1_050);
    expect(forfeitureToJury?.payeeId).toBe("jury-1");
    expect(forfeitureToProtocol?.amount).toBe(450);
    expect(forfeitureToProtocol?.payeeId).toBe("protocol:treasury");

    const replay = await requestJson<EventReplayResponse>(app, "/events/replay?fromOffset=0&limit=500");
    const names = replay.records.map((record) => record.event.name);
    expect(names).toContain("mission.challenge_opened");
    expect(names).toContain("mission.challenge_resolved");
  });
});
