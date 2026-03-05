import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createContainer } from "../application/container";
import { ParticipantNotFoundError } from "../application/modules/pact-id";
import type { DataCategory } from "../domain/data-marketplace";
import type { ValidationConfig } from "../domain/validation-pipeline";
import type { TaskEvidence } from "../domain/types";
import type {
  ZKCompletionClaim,
  ZKIdentityClaim,
  ZKLocationClaim,
  ZKReputationClaim,
} from "../domain/zk-proofs";

export function createApp(validationConfig?: ValidationConfig) {
  const container = createContainer(validationConfig);
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, service: "pact-network-core-bun" }));

  app.post("/id/participants", async (c) => {
    const body = await c.req.json();
    const participant = await container.pactID.registerParticipant({
      id: String(body.id),
      role: body.role,
      displayName: String(body.displayName),
      skills: Array.isArray(body.skills) ? body.skills.map(String) : [],
      capacity: typeof body.capacity === "number" ? body.capacity : undefined,
      location: body.location,
      initialReputation:
        typeof body.initialReputation === "number" ? body.initialReputation : undefined,
    });
    return c.json(participant, 201);
  });

  app.get("/id/workers", async (c) => {
    return c.json(await container.pactID.listWorkers());
  });

  app.get("/id/did/:participantId", async (c) => {
    const didDocument = await container.pactID.getDIDDocument(c.req.param("participantId"));
    return c.json(didDocument);
  });

  app.get("/id/participants/:id/level", async (c) => {
    const participantId = c.req.param("id");
    try {
      const level = await container.pactID.getIdentityLevel(participantId);
      return c.json({ participantId, level });
    } catch (error) {
      rethrowParticipantNotFound(error);
    }
  });

  app.post("/id/participants/:id/upgrade-level", async (c) => {
    const participantId = c.req.param("id");
    try {
      return c.json(await container.pactID.upgradeIdentityLevel(participantId));
    } catch (error) {
      rethrowParticipantNotFound(error);
    }
  });

  app.get("/id/participants/:id/stats", async (c) => {
    const participantId = c.req.param("id");
    const stats = await container.pactID.getParticipantStats(participantId);
    if (!stats) {
      throw new HTTPException(404, { message: `Participant not found: ${participantId}` });
    }
    return c.json(stats);
  });

  app.post("/id/participants/:id/task-completed", async (c) => {
    const participantId = c.req.param("id");
    try {
      return c.json(await container.pactID.recordTaskCompletion(participantId));
    } catch (error) {
      rethrowParticipantNotFound(error);
    }
  });

  app.post("/id/credentials", async (c) => {
    const body = await c.req.json();
    const credential = await container.pactID.issueCredential(
      String(body.issuerId),
      String(body.subjectId),
      String(body.capability),
      body.additionalClaims,
      typeof body.expirationDate === "number" ? body.expirationDate : undefined,
    );
    return c.json(credential, 201);
  });

  app.post("/id/credentials/verify", async (c) => {
    const body = await c.req.json();
    const valid = await container.pactID.verifyCredential(body.credential);
    return c.json({ valid });
  });

  app.get("/id/capabilities/:participantId/:capability", async (c) => {
    const hasCapability = await container.pactID.checkCapability(
      c.req.param("participantId"),
      c.req.param("capability"),
    );
    return c.json({ hasCapability });
  });

  app.post("/zk/proofs/location", async (c) => {
    const body = await c.req.json();
    const claimBody = getClaimBody(body);
    const claim: ZKLocationClaim = {
      latitude: Number(claimBody.latitude),
      longitude: Number(claimBody.longitude),
      radius: Number(claimBody.radius),
      timestamp: typeof claimBody.timestamp === "number" ? claimBody.timestamp : Date.now(),
    };
    const proof = await container.pactZK.generateLocationProof(String(body.proverId), claim);
    return c.json(proof, 201);
  });

  app.post("/zk/proofs/completion", async (c) => {
    const body = await c.req.json();
    const claimBody = getClaimBody(body);
    const claim: ZKCompletionClaim = {
      taskId: String(claimBody.taskId),
      evidenceHash: String(claimBody.evidenceHash),
      completedAt: typeof claimBody.completedAt === "number" ? claimBody.completedAt : Date.now(),
    };
    const proof = await container.pactZK.generateCompletionProof(String(body.proverId), claim);
    return c.json(proof, 201);
  });

  app.post("/zk/proofs/identity", async (c) => {
    const body = await c.req.json();
    const claimBody = getClaimBody(body);
    const claim: ZKIdentityClaim = {
      participantId: String(claimBody.participantId),
      isHuman: Boolean(claimBody.isHuman),
    };
    const proof = await container.pactZK.generateIdentityProof(String(body.proverId), claim);
    return c.json(proof, 201);
  });

  app.post("/zk/proofs/reputation", async (c) => {
    const body = await c.req.json();
    const claimBody = getClaimBody(body);
    const claim: ZKReputationClaim = {
      participantId: String(claimBody.participantId),
      minScore: Number(claimBody.minScore),
      actualAbove: Boolean(claimBody.actualAbove),
    };
    const proof = await container.pactZK.generateReputationProof(String(body.proverId), claim);
    return c.json(proof, 201);
  });

  app.post("/zk/proofs/:id/verify", async (c) => {
    const valid = await container.pactZK.verifyProof(c.req.param("id"));
    return c.json({ valid });
  });

  app.get("/zk/proofs/:id", async (c) => {
    const proof = await container.pactZK.getProof(c.req.param("id"));
    return c.json(proof);
  });

  app.post("/tasks", async (c) => {
    const body = await c.req.json();
    const task = await container.pactTasks.createTask({
      title: String(body.title),
      description: String(body.description),
      issuerId: String(body.issuerId),
      paymentCents: Number(body.paymentCents),
      location: body.location,
      constraints: body.constraints,
    });
    return c.json(task, 201);
  });

  app.post("/tasks/:id/assign", async (c) => {
    const taskId = c.req.param("id");
    const body = await c.req.json();

    const task = body.workerId
      ? await container.pactTasks.assignTask(taskId, String(body.workerId))
      : await container.pactTasks.autoAssignTask(taskId);

    return c.json(task);
  });

  app.post("/tasks/:id/submit", async (c) => {
    const taskId = c.req.param("id");
    const body = await c.req.json();

    const evidence: TaskEvidence = {
      summary: String(body.summary),
      artifactUris: Array.isArray(body.artifactUris) ? body.artifactUris.map(String) : [],
      submittedAt: Date.now(),
      validation: body.validation,
    };

    const task = await container.pactTasks.submitEvidence(taskId, evidence);
    const latestTask = await container.pactTasks.getTask(task.id);
    return c.json(latestTask);
  });

  app.get("/tasks", async (c) => c.json(await container.pactTasks.listTasks()));

  app.get("/tasks/:id", async (c) => {
    const task = await container.pactTasks.getTask(c.req.param("id"));
    return c.json(task);
  });

  app.get("/payments/ledger", async (c) => {
    return c.json(await container.pactPay.ledger());
  });

  app.get("/compute/providers", async (c) => {
    return c.json(await container.pactCompute.listProviders());
  });

  app.post("/compute/providers", async (c) => {
    const body = await c.req.json();
    const provider = {
      id: String(body.id),
      name: String(body.name),
      capabilities: {
        cpuCores: Number(body.capabilities?.cpuCores),
        memoryMB: Number(body.capabilities?.memoryMB),
        gpuCount: Number(body.capabilities?.gpuCount),
        gpuModel: body.capabilities?.gpuModel ? String(body.capabilities.gpuModel) : undefined,
      },
      pricePerCpuSecondCents: Number(body.pricePerCpuSecondCents),
      pricePerGpuSecondCents: Number(body.pricePerGpuSecondCents),
      pricePerMemoryMBHourCents: Number(body.pricePerMemoryMBHourCents),
      status: body.status,
      registeredAt: typeof body.registeredAt === "number" ? body.registeredAt : Date.now(),
    };
    await container.pactCompute.registerProvider(provider);
    return c.json(provider, 201);
  });

  app.get("/compute/providers/search", async (c) => {
    const minCpuValue = c.req.query("minCpu");
    const minMemoryValue = c.req.query("minMemory");
    const minGpuValue = c.req.query("minGpu");
    const providers = await container.pactCompute.findProviders(
      minCpuValue ? Number(minCpuValue) : 1,
      minMemoryValue ? Number(minMemoryValue) : 1,
      minGpuValue ? Number(minGpuValue) : undefined,
    );
    return c.json(providers);
  });

  app.get("/compute/pricing/tiers", async (c) => {
    return c.json(container.pactCompute.listPricingTiers());
  });

  app.post("/compute/pricing/quote", async (c) => {
    const body = await c.req.json();
    const capabilities = {
      cpuCores: toNonNegativeNumber(body.capabilities?.cpuCores, 0),
      memoryMB: toNonNegativeNumber(body.capabilities?.memoryMB, 0),
      gpuCount: toNonNegativeNumber(body.capabilities?.gpuCount, 0),
      gpuModel: body.capabilities?.gpuModel ? String(body.capabilities.gpuModel) : undefined,
    };
    const durationSeconds = toNonNegativeNumber(
      typeof body.durationSeconds === "number"
        ? body.durationSeconds
        : body.estimatedDurationSeconds,
      0,
    );
    const quote = container.pactCompute.quoteCost(capabilities, durationSeconds);
    if (!quote) {
      throw new HTTPException(400, {
        message: "No pricing tier matches the requested capabilities",
      });
    }
    return c.json(quote);
  });

  app.post("/compute/jobs", async (c) => {
    const body = await c.req.json();
    const job = await container.pactCompute.enqueueComputeJob({
      image: String(body.image),
      command: String(body.command),
      runAt: typeof body.runAt === "number" ? body.runAt : undefined,
      metadata: body.metadata,
    });
    return c.json(job, 201);
  });

  app.post("/compute/jobs/:jobId/dispatch", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const result = await container.pactCompute.dispatchJob(
      c.req.param("jobId"),
      body.providerId ? String(body.providerId) : undefined,
    );
    return c.json(result);
  });

  app.get("/compute/usage", async (c) => {
    const jobId = c.req.query("jobId");
    return c.json(await container.pactCompute.getUsageRecords(jobId));
  });

  app.post("/heartbeat/tasks", async (c) => {
    const body = await c.req.json();
    const task = await container.pactHeartbeat.registerTask({
      name: String(body.name),
      intervalMs: Number(body.intervalMs),
      payload: body.payload,
      startAt: typeof body.startAt === "number" ? body.startAt : undefined,
    });
    return c.json(task, 201);
  });

  app.get("/heartbeat/tasks", async (c) => {
    return c.json(await container.pactHeartbeat.listTasks());
  });

  app.post("/heartbeat/tasks/:id/enable", async (c) => {
    const task = await container.pactHeartbeat.enableTask(c.req.param("id"));
    return c.json(task);
  });

  app.post("/heartbeat/tasks/:id/disable", async (c) => {
    const task = await container.pactHeartbeat.disableTask(c.req.param("id"));
    return c.json(task);
  });

  app.post("/heartbeat/tick", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const executions = await container.pactHeartbeat.tick(
      typeof body.now === "number" ? body.now : undefined,
    );
    return c.json(executions);
  });

  app.get("/data/assets", async (c) => {
    return c.json(await container.pactData.list());
  });

  app.post("/data/assets", async (c) => {
    const body = await c.req.json();
    const asset = await container.pactData.publish({
      ownerId: String(body.ownerId),
      title: String(body.title),
      uri: String(body.uri),
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
      derivedFrom: Array.isArray(body.derivedFrom) ? body.derivedFrom.map(String) : undefined,
    });
    return c.json(asset, 201);
  });

  app.get("/data/assets/:assetId/lineage", async (c) => {
    const lineage = await container.pactData.getLineage(c.req.param("assetId"));
    return c.json(lineage);
  });

  app.get("/data/assets/:assetId/dependents", async (c) => {
    const dependents = await container.pactData.getDependents(c.req.param("assetId"));
    return c.json(dependents);
  });

  app.post("/data/assets/:assetId/integrity", async (c) => {
    const body = await c.req.json();
    const proof = await container.pactData.registerIntegrityProof(
      c.req.param("assetId"),
      body.contentHash ? String(body.contentHash) : String(body.hash),
    );
    return c.json(proof, 201);
  });

  app.post("/data/assets/:assetId/integrity/verify", async (c) => {
    const body = await c.req.json();
    const valid = await container.pactData.verifyIntegrity(
      c.req.param("assetId"),
      body.contentHash ? String(body.contentHash) : String(body.hash),
    );
    return c.json({ valid });
  });

  app.put("/data/assets/:assetId/access", async (c) => {
    const body = await c.req.json();
    const policy = await container.pactData.setAccessPolicy(
      c.req.param("assetId"),
      Array.isArray(body.allowedParticipantIds) ? body.allowedParticipantIds.map(String) : [],
      Boolean(body.isPublic),
    );
    return c.json(policy);
  });

  app.get("/data/assets/:assetId/access/:participantId", async (c) => {
    const allowed = await container.pactData.checkAccess(
      c.req.param("assetId"),
      c.req.param("participantId"),
    );
    return c.json({ allowed });
  });

  app.post("/data/marketplace/list", async (c) => {
    const body = await c.req.json();
    if (!isDataCategory(body.category)) {
      throw new HTTPException(400, { message: "Invalid data category" });
    }

    const listing = await container.pactData.listAsset(
      String(body.assetId),
      Number(body.priceCents),
      body.category,
    );
    return c.json(listing, 201);
  });

  app.delete("/data/marketplace/listings/:id", async (c) => {
    await container.pactData.delistAsset(c.req.param("id"));
    return c.body(null, 204);
  });

  app.get("/data/marketplace/listings", async (c) => {
    const category = c.req.query("category");
    if (category && !isDataCategory(category)) {
      throw new HTTPException(400, { message: "Invalid data category" });
    }
    return c.json(await container.pactData.listMarketplace(category));
  });

  app.post("/data/marketplace/purchase", async (c) => {
    const body = await c.req.json();
    const purchase = await container.pactData.purchaseAsset(
      String(body.listingId),
      String(body.buyerId),
    );
    return c.json(purchase, 201);
  });

  app.get("/data/marketplace/stats", async (c) => {
    return c.json(await container.pactData.getMarketplaceStats());
  });

  app.post("/economics/assets", async (c) => {
    const body = await c.req.json();
    const asset = await container.pactEconomics.registerAsset({
      id: body.id ? String(body.id) : undefined,
      kind: body.kind,
      symbol: String(body.symbol),
      network: body.network ? String(body.network) : undefined,
      issuer: body.issuer ? String(body.issuer) : undefined,
      metadata: body.metadata,
    });
    return c.json(asset, 201);
  });

  app.get("/economics/assets", async (c) => {
    return c.json(await container.pactEconomics.listAssets());
  });

  app.post("/economics/quote", async (c) => {
    const body = await c.req.json();
    const quote = await container.pactEconomics.quoteCompensation(body);
    return c.json(quote);
  });

  app.post("/economics/valuations", async (c) => {
    const body = await c.req.json();
    const valuation = await container.pactEconomics.registerValuation({
      assetId: String(body.assetId),
      referenceAssetId: String(body.referenceAssetId),
      rate: Number(body.rate),
      asOf: typeof body.asOf === "number" ? body.asOf : undefined,
      source: body.source ? String(body.source) : undefined,
    });
    return c.json(valuation, 201);
  });

  app.get("/economics/valuations", async (c) => {
    const referenceAssetId = c.req.query("referenceAssetId");
    return c.json(await container.pactEconomics.listValuations(referenceAssetId));
  });

  app.post("/economics/quote-reference", async (c) => {
    const body = await c.req.json();
    const quote = await container.pactEconomics.quoteInReference(
      body.model,
      String(body.referenceAssetId),
    );
    return c.json(quote);
  });

  app.post("/economics/settlement-plan", async (c) => {
    const body = await c.req.json();
    const plan = await container.pactEconomics.planSettlement(body);
    return c.json(plan, 201);
  });

  app.post("/economics/settlements/execute", async (c) => {
    const body = await c.req.json();
    const result = await container.pactEconomics.executeSettlement({
      model: body.model,
      settlementId: body.settlementId ? String(body.settlementId) : undefined,
    });
    return c.json(result, 201);
  });

  app.get("/economics/settlements/records", async (c) => {
    const railValue = c.req.query("rail");
    const rail = isSettlementRail(railValue) ? railValue : undefined;
    const statusValue = c.req.query("status");
    const status = isSettlementRecordStatus(statusValue) ? statusValue : undefined;
    const records = await container.pactEconomics.listSettlementRecords({
      settlementId: c.req.query("settlementId"),
      assetId: c.req.query("assetId"),
      rail,
      payerId: c.req.query("payerId"),
      payeeId: c.req.query("payeeId"),
      status,
      reconciledBy: c.req.query("reconciledBy"),
    });
    return c.json(records);
  });

  app.get("/economics/settlements/records/page", async (c) => {
    const railValue = c.req.query("rail");
    const rail = isSettlementRail(railValue) ? railValue : undefined;
    const statusValue = c.req.query("status");
    const status = isSettlementRecordStatus(statusValue) ? statusValue : undefined;
    const limitValue = c.req.query("limit");
    const page = await container.pactEconomics.querySettlementRecords({
      settlementId: c.req.query("settlementId"),
      assetId: c.req.query("assetId"),
      rail,
      payerId: c.req.query("payerId"),
      payeeId: c.req.query("payeeId"),
      status,
      reconciledBy: c.req.query("reconciledBy"),
      cursor: c.req.query("cursor"),
      limit: limitValue ? Number(limitValue) : undefined,
    });
    return c.json(page);
  });

  app.get("/economics/settlements/records/replay", async (c) => {
    const fromOffsetValue = c.req.query("fromOffset");
    const limitValue = c.req.query("limit");
    const replay = await container.pactEconomics.replaySettlementRecordLifecycle({
      fromOffset: fromOffsetValue ? Number(fromOffsetValue) : undefined,
      limit: limitValue ? Number(limitValue) : undefined,
    });
    return c.json(replay);
  });

  app.get("/economics/settlements/records/:id", async (c) => {
    const record = await container.pactEconomics.getSettlementRecord(c.req.param("id"));
    if (!record) {
      throw new HTTPException(404, { message: "Settlement record not found" });
    }
    return c.json(record);
  });

  app.post("/economics/settlements/records/:id/reconcile", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const record = await container.pactEconomics.reconcileSettlementRecord({
      recordId: c.req.param("id"),
      reconciledBy: body.reconciledBy ? String(body.reconciledBy) : undefined,
      note: body.note ? String(body.note) : undefined,
      reconciledAt: typeof body.reconciledAt === "number" ? body.reconciledAt : undefined,
    });
    return c.json(record);
  });

  app.get("/dev/integrations", async (c) => {
    return c.json(await container.pactDev.list());
  });

  app.post("/dev/integrations", async (c) => {
    const body = await c.req.json();
    const integration = await container.pactDev.register({
      ownerId: String(body.ownerId),
      name: String(body.name),
      webhookUrl: String(body.webhookUrl),
    });
    return c.json(integration, 201);
  });

  app.post("/dev/integrations/:id/activate", async (c) => {
    const integration = await container.pactDev.activate(c.req.param("id"));
    return c.json(integration);
  });

  app.post("/dev/integrations/:id/suspend", async (c) => {
    const integration = await container.pactDev.suspend(c.req.param("id"));
    return c.json(integration);
  });

  app.post("/dev/integrations/:id/deprecate", async (c) => {
    const integration = await container.pactDev.deprecate(c.req.param("id"));
    return c.json(integration);
  });

  app.get("/dev/policies", async (c) => {
    return c.json(await container.pactDev.listPolicies());
  });

  app.post("/dev/policies", async (c) => {
    const body = await c.req.json();
    const createdAt = typeof body.createdAt === "number" ? body.createdAt : Date.now();
    const policyPackage = {
      id: body.id ? String(body.id) : `pkg_${crypto.randomUUID()}`,
      name: String(body.name),
      version: String(body.version),
      rules: Array.isArray(body.rules) ? body.rules : [],
      ownerId: String(body.ownerId),
      createdAt,
      updatedAt: typeof body.updatedAt === "number" ? body.updatedAt : createdAt,
    };
    await container.pactDev.registerPolicy(policyPackage);
    return c.json(policyPackage, 201);
  });

  app.post("/dev/policies/evaluate", async (c) => {
    const body = await c.req.json();
    const context = body.context && typeof body.context === "object" ? body.context : body;
    const result = await container.pactDev.evaluatePolicy(context);
    return c.json(result);
  });

  app.get("/dev/templates", async (c) => {
    return c.json(await container.pactDev.listTemplates());
  });

  app.post("/dev/templates", async (c) => {
    const body = await c.req.json();
    const template = await container.pactDev.registerTemplate({
      name: String(body.name),
      language: String(body.language),
      repoUrl: String(body.repoUrl),
      description: String(body.description),
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
    });
    return c.json(template, 201);
  });

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return error.getResponse();
    }

    return c.json(
      {
        error: error.name,
        message: error.message,
      },
      400,
    );
  });

  return app;
}

function isSettlementRail(
  value?: string,
): value is "llm_metering" | "cloud_billing" | "api_quota" {
  return value === "llm_metering" || value === "cloud_billing" || value === "api_quota";
}

function isSettlementRecordStatus(value?: string): value is "applied" | "reconciled" {
  return value === "applied" || value === "reconciled";
}

function rethrowParticipantNotFound(error: unknown): never {
  if (error instanceof ParticipantNotFoundError) {
    throw new HTTPException(404, { message: error.message });
  }
  throw error;
}

function isDataCategory(value?: string): value is DataCategory {
  return (
    value === "geolocation" ||
    value === "image_video" ||
    value === "survey" ||
    value === "sensor" ||
    value === "labeled" ||
    value === "other"
  );
}

function toNonNegativeNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value >= 0 ? value : fallback;
}

function getClaimBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") {
    return {};
  }

  const payload = body as Record<string, unknown>;
  if (payload.claim && typeof payload.claim === "object") {
    return payload.claim as Record<string, unknown>;
  }

  return payload;
}
