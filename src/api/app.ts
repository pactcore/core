import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { AdapterOperationError } from "../application/adapter-runtime";
import { createApiKeyAuth } from "./middleware/api-key-auth";
import { createRateLimiter } from "./middleware/rate-limiter";
import { createUsageTracker, UsageTracker } from "./middleware/usage-tracker";
import { createContainer } from "../application/container";
import type { PactContainer } from "../application/container";
import { ParticipantNotFoundError } from "../application/modules/pact-id";
import type { AnalyticsPeriod } from "../application/modules/pact-analytics";
import type { AntiSpamAction } from "../domain/anti-spam";
import type { DataCategory } from "../domain/data-marketplace";
import type { DisputeStatus } from "../domain/dispute-resolution";
import type { ReputationCategory } from "../domain/reputation-multi";
import { getApplicableRoles, getParticipantCategory, isParticipantType } from "../domain/participant-matrix";
import {
  canPerformAction,
  getRoleCapabilities,
  getRoleRequirements,
  isRoleModule,
  parseParticipantRole,
} from "../domain/role-matrix";
import type { ValidationConfig } from "../domain/validation-pipeline";
import type { TaskEvidence } from "../domain/types";
import {
  TOKENOMICS_MODEL,
  calculateBurnRate,
  calculateCirculatingSupply,
  calculateStakingAPY,
  getDistribution,
  projectTokenSupply,
} from "../domain/token-economics";
import { InMemoryApiKeyStore } from "../infrastructure/api/in-memory-api-key-store";
import { InMemoryMetricsRegistry } from "../observability/metrics";
import { InMemoryTracer } from "../observability/tracing";
import type {
  ZKCompletionClaim,
  ZKIdentityClaim,
  ZKLocationClaim,
  ZKProofType,
  ZKReputationClaim,
} from "../domain/zk-proofs";

export interface CreateAppOptions {
  container?: PactContainer;
  enforceApiKeyAuth?: boolean;
  antiSpamEnabled?: boolean;
  rateLimit?: {
    windowMs?: number;
    maxRequests?: number;
  };
}

export function createApp(validationConfig?: ValidationConfig, options: CreateAppOptions = {}) {
  const container = options.container ?? createContainer(validationConfig);
  const app = new Hono();
  const observabilityStartedAt = Date.now();
  const metricsRegistry = new InMemoryMetricsRegistry();
  const tracer = new InMemoryTracer();
  const requestCounter = metricsRegistry.counter(
    "http_requests_total",
    "Total HTTP requests by route, method, and status",
  );
  const requestErrorCounter = metricsRegistry.counter(
    "http_request_errors_total",
    "Total HTTP errors by route, method, and status",
  );
  const requestLatencyHistogram = metricsRegistry.histogram("http_request_latency_ms", {
    description: "HTTP request latency in milliseconds by route, method, and status",
    buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000],
  });
  const inFlightGauge = metricsRegistry.gauge(
    "http_requests_in_flight",
    "Current in-flight HTTP requests",
  );
  const apiKeyStore = new InMemoryApiKeyStore();
  const usageTracker = new UsageTracker();
  const shouldRequireApiKey = () => options.enforceApiKeyAuth === true || apiKeyStore.hasKeys();
  const enforceAntiSpamPolicy = async (
    c: Context,
    participantId: string,
    action: AntiSpamAction,
    providedStakeCents?: number,
  ): Promise<void> => {
    if (options.antiSpamEnabled === false) return;
    const rateLimit = await container.pactAntiSpam.checkRateLimit(participantId, action);
    if (!rateLimit.allowed) {
      if (rateLimit.retryAfterMs !== undefined) {
        c.header("Retry-After", String(Math.ceil(rateLimit.retryAfterMs / 1_000)));
      }
      throw new HTTPException(429, {
        message: `Anti-spam rate limit exceeded for ${action}`,
      });
    }

    if (providedStakeCents !== undefined) {
      const { stakeCents } = await container.pactAntiSpam.calculateRequiredStake(participantId, action);
      if (providedStakeCents < stakeCents) {
        throw new HTTPException(400, {
          message: `Insufficient anti-spam stake for ${action}: required ${stakeCents} cents`,
        });
      }
    }
  };

  app.use("*", async (c, next) => {
    const startedAt = Date.now();
    const span = tracer.startSpan("http.request", {
      attributes: {
        "http.method": c.req.method,
        "http.target": c.req.path,
      },
    });
    inFlightGauge.inc();

    let requestError: unknown;
    try {
      await next();
    } catch (error) {
      requestError = error;
      span.recordError(error);
      throw error;
    } finally {
      const statusCode = resolveStatusCode(c.res.status, requestError);
      const route = resolveRoutePath(c.req.routePath, c.req.path);
      const labels = {
        method: c.req.method,
        route,
        status: String(statusCode),
      };
      const latencyMs = Math.max(0, Date.now() - startedAt);

      requestCounter.inc(labels);
      requestLatencyHistogram.observe(latencyMs, labels);
      if (statusCode >= 400 || requestError) {
        requestErrorCounter.inc(labels);
      }

      inFlightGauge.dec();
      span.setAttributes({
        "http.route": route,
        "http.status_code": statusCode,
        "http.latency_ms": latencyMs,
      });
      span.end({
        status: statusCode >= 400 ? "error" : "ok",
      });
    }
  });

  app.use(
    "*",
    createRateLimiter({
      windowMs: options.rateLimit?.windowMs ?? 60_000,
      maxRequests: options.rateLimit?.maxRequests ?? 100,
    }),
  );
  app.use("*", createUsageTracker(usageTracker));

  const apiKeyAuth = createApiKeyAuth({
    validator: async (key) => apiKeyStore.validateKey(key),
  });

  app.use("*", async (c, next) => {
    if (c.req.path === "/health" || c.req.path.startsWith("/observability/")) {
      return next();
    }

    if (!shouldRequireApiKey()) {
      return next();
    }

    return apiKeyAuth(c, next);
  });

  app.get("/health", (c) => c.json({ ok: true, service: "pact-network-core-bun" }));

  app.get("/observability/health", (c) => {
    const snapshot = metricsRegistry.snapshot();
    return c.json({
      ok: true,
      service: "pact-network-core-bun",
      uptimeMs: Math.max(0, Date.now() - observabilityStartedAt),
      metricFamilies: {
        counters: snapshot.counters.length,
        gauges: snapshot.gauges.length,
        histograms: snapshot.histograms.length,
      },
      traces: {
        stored: tracer.size(),
      },
      timestamp: Date.now(),
    });
  });

  app.get("/observability/metrics", (c) => {
    return c.json(metricsRegistry.snapshot());
  });

  app.get("/observability/traces", (c) => {
    const limit = normalizeLimitValue(c.req.query("limit"), 50, 500);
    return c.json({
      limit,
      traces: tracer.getTraces(limit),
    });
  });

  app.get("/events/replay", async (c) => {
    const fromOffsetValue = c.req.query("fromOffset");
    const fromOffset = normalizeOffsetValue(fromOffsetValue);
    const limit = normalizeLimitValue(c.req.query("limit"), 100, 1_000);
    return c.json({
      records: await container.eventJournal.replay(fromOffset, limit),
      nextOffset: fromOffset !== undefined ? fromOffset + limit : limit,
    });
  });

  app.get("/analytics/network", async (c) => {
    return c.json(await container.pactAnalytics.getNetworkStats());
  });

  app.get("/analytics/tasks", async (c) => {
    const periodValue = c.req.query("period");
    const period = periodValue ?? "day";
    if (!isAnalyticsPeriod(period)) {
      throw new HTTPException(400, { message: "Invalid analytics period" });
    }
    return c.json(await container.pactAnalytics.getTaskAnalytics(period));
  });

  app.get("/analytics/economics", async (c) => {
    return c.json(await container.pactAnalytics.getEconomicAnalytics());
  });

  app.get("/analytics/security", async (c) => {
    return c.json(await container.pactAnalytics.getSecurityAnalytics());
  });

  app.get("/ecosystem/status", async (c) => {
    return c.json(await container.pactEcosystem.getEcosystemStatus());
  });

  app.get("/ecosystem/modules", async (c) => {
    return c.json(container.pactEcosystem.getModuleGraph());
  });

  app.get("/ecosystem/synergy", async (c) => {
    return c.json(await container.pactEcosystem.getCrossAppMetrics());
  });

  app.post("/admin/api-keys", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const ownerId = body.ownerId ? String(body.ownerId) : "";
    if (!ownerId) {
      throw new HTTPException(400, { message: "ownerId is required" });
    }

    const permissions = Array.isArray(body.permissions) ? body.permissions.map(String) : [];
    const rateLimit =
      typeof body.rateLimit === "number" && Number.isFinite(body.rateLimit) && body.rateLimit > 0
        ? Math.floor(body.rateLimit)
        : undefined;
    const registered = apiKeyStore.registerKey(ownerId, permissions, rateLimit);
    return c.json(registered, 201);
  });

  app.get("/admin/api-keys", async (c) => {
    const ownerId = c.req.query("ownerId");
    if (!ownerId) {
      throw new HTTPException(400, { message: "ownerId query parameter is required" });
    }

    return c.json(apiKeyStore.listKeys(ownerId));
  });

  app.delete("/admin/api-keys/:id", async (c) => {
    const revoked = apiKeyStore.revokeKey(c.req.param("id"));
    if (!revoked) {
      throw new HTTPException(404, { message: "API key not found" });
    }

    return c.body(null, 204);
  });

  app.get("/admin/usage", async (c) => {
    const apiKeyId = c.req.query("apiKeyId");
    if (!apiKeyId) {
      throw new HTTPException(400, { message: "apiKeyId query parameter is required" });
    }

    return c.json(usageTracker.getStats(apiKeyId));
  });

  app.get("/admin/usage/overall", async (c) => {
    return c.json(usageTracker.getOverallStats());
  });

  app.post("/anti-spam/check", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const participantId = body.participantId ? String(body.participantId) : "";
    const action = body.action ? String(body.action) : "";
    if (!participantId) {
      throw new HTTPException(400, { message: "participantId is required" });
    }
    if (!isAntiSpamAction(action)) {
      throw new HTTPException(400, { message: "Invalid anti-spam action" });
    }

    const rateLimit = await container.pactAntiSpam.checkRateLimit(participantId, action);
    const requiredStake = await container.pactAntiSpam.calculateRequiredStake(participantId, action);
    return c.json({
      participantId,
      action,
      ...rateLimit,
      ...requiredStake,
    });
  });

  app.post("/anti-spam/record", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const participantId = body.participantId ? String(body.participantId) : "";
    const action = body.action ? String(body.action) : "";
    if (!participantId) {
      throw new HTTPException(400, { message: "participantId is required" });
    }
    if (!isAntiSpamAction(action)) {
      throw new HTTPException(400, { message: "Invalid anti-spam action" });
    }

    await container.pactAntiSpam.recordAction(participantId, action);
    return c.json({ recorded: true }, 201);
  });

  app.get("/anti-spam/:participantId/profile", async (c) => {
    return c.json(await container.pactAntiSpam.getParticipantSpamProfile(c.req.param("participantId")));
  });

  app.get("/security/threats", async (c) => {
    return c.json(container.pactSecurity.getThreatModel());
  });

  app.post("/security/audit", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const participants = getRequiredNumberField(body, "participants");
    const transactions = getRequiredNumberField(body, "transactions");
    const disputes = getRequiredNumberField(body, "disputes");
    const avgReputation = getRequiredNumberField(body, "avgReputation");

    if (participants < 0 || transactions < 0 || disputes < 0) {
      throw new HTTPException(400, {
        message: "participants, transactions, and disputes must be non-negative numbers",
      });
    }
    if (avgReputation < 0 || avgReputation > 100) {
      throw new HTTPException(400, { message: "avgReputation must be between 0 and 100" });
    }

    return c.json(
      container.pactSecurity.runAudit({
        participants,
        transactions,
        disputes,
        avgReputation,
      }),
    );
  });

  app.get("/security/sybil-resistance/:participantId", async (c) => {
    const participantId = c.req.param("participantId");
    return c.json(await container.pactSecurity.checkSybilResistance(participantId));
  });

  app.get("/reputation/leaderboard", async (c) => {
    const category = c.req.query("category");
    if (category && !isReputationCategory(category)) {
      throw new HTTPException(400, { message: "Invalid reputation category" });
    }

    const limitValue = c.req.query("limit");
    const limit = limitValue ? Number(limitValue) : undefined;
    const leaderboard = await container.pactReputation.getLeaderboard(
      category,
      typeof limit === "number" && Number.isFinite(limit) ? limit : undefined,
    );
    return c.json(leaderboard);
  });

  app.get("/reputation/:participantId", async (c) => {
    return c.json(await container.pactReputation.getProfile(c.req.param("participantId")));
  });

  app.post("/reputation/:participantId/events", async (c) => {
    const body = await c.req.json();
    const category = body.category ? String(body.category) : "";
    if (!isReputationCategory(category)) {
      throw new HTTPException(400, { message: "Invalid reputation category" });
    }

    const delta = Number(body.delta);
    if (!Number.isFinite(delta)) {
      throw new HTTPException(400, { message: "Invalid delta value" });
    }

    const profile = await container.pactReputation.recordEvent(
      c.req.param("participantId"),
      category,
      delta,
      body.reason ? String(body.reason) : "unspecified",
    );

    return c.json(profile, 201);
  });

  app.get("/reputation/:participantId/history", async (c) => {
    const limitValue = c.req.query("limit");
    const limit = limitValue ? Number(limitValue) : undefined;
    return c.json(
      await container.pactReputation.getHistory(
        c.req.param("participantId"),
        typeof limit === "number" && Number.isFinite(limit) ? limit : undefined,
      ),
    );
  });

  app.get("/roles/:role/capabilities", async (c) => {
    const role = parseParticipantRole(c.req.param("role"));
    if (!role) {
      throw new HTTPException(400, { message: "Invalid role" });
    }

    return c.json({
      role,
      capabilities: getRoleCapabilities(role),
    });
  });

  app.get("/roles/:role/requirements", async (c) => {
    const role = parseParticipantRole(c.req.param("role"));
    if (!role) {
      throw new HTTPException(400, { message: "Invalid role" });
    }

    return c.json({
      role,
      requirements: getRoleRequirements(role),
    });
  });

  app.post("/roles/check-action", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const role = parseParticipantRole(body.role ? String(body.role) : undefined);
    if (!role) {
      throw new HTTPException(400, { message: "Invalid role" });
    }

    const moduleValue = body.module ? String(body.module) : "";
    if (!moduleValue) {
      throw new HTTPException(400, { message: "module is required" });
    }
    if (!isRoleModule(moduleValue)) {
      throw new HTTPException(400, { message: "Invalid role module" });
    }

    const action = body.action ? String(body.action) : "";
    if (!action) {
      throw new HTTPException(400, { message: "action is required" });
    }

    return c.json({
      role,
      module: moduleValue,
      action,
      allowed: canPerformAction(role, action, moduleValue),
    });
  });

  app.post("/participants/matrix/category", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const type = body.type ? String(body.type) : "";
    if (!isParticipantType(type)) {
      throw new HTTPException(400, { message: "Invalid participant type" });
    }
    if (typeof body.isAgent !== "boolean") {
      throw new HTTPException(400, { message: "isAgent must be a boolean" });
    }

    const category = getParticipantCategory(type, body.isAgent);
    return c.json({
      type,
      isAgent: body.isAgent,
      category,
      applicableRoles: getApplicableRoles(category),
    });
  });

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

  app.get("/id/onchain/:participantId", async (c) => {
    const participantId = c.req.param("participantId");
    try {
      const identity = await container.pactID.getOnchainIdentity(participantId);
      return c.json(identity ?? null);
    } catch (error) {
      rethrowParticipantNotFound(error);
    }
  });

  app.post("/id/onchain/:participantId/sync", async (c) => {
    const participantId = c.req.param("participantId");
    try {
      const identity = await container.pactID.syncOnchainIdentity(participantId);
      return c.json(identity ?? null);
    } catch (error) {
      rethrowParticipantNotFound(error);
    }
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
    const proofId = c.req.param("id");
    const valid = await container.pactZK.verifyProof(proofId);
    const receipts = await container.pactZK.getVerificationReceipts(proofId);
    return c.json({ valid, receipt: receipts.at(-1) });
  });

  app.get("/zk/proofs/:id", async (c) => {
    const proof = await container.pactZK.getProof(c.req.param("id"));
    return c.json(proof);
  });

  app.get("/zk/proofs/:id/receipts", async (c) => {
    return c.json(await container.pactZK.getVerificationReceipts(c.req.param("id")));
  });

  app.get("/zk/circuits/:type", async (c) => {
    const proofType = c.req.param("type");
    if (!isZKProofType(proofType)) {
      throw new HTTPException(400, { message: "Invalid ZK proof type" });
    }
    return c.json(container.pactZK.getCircuitDefinition(proofType));
  });

  app.post("/zk/formal-verify/:proofId", async (c) => {
    const result = await container.pactZK.verifyFormalProperties(c.req.param("proofId"));
    if (!result) {
      throw new HTTPException(404, { message: "ZK proof not found" });
    }
    return c.json(result);
  });

  app.post("/tasks", async (c) => {
    const body = await c.req.json();
    const issuerId = String(body.issuerId);
    const providedStakeCents =
      typeof body.stakeCents === "number" && Number.isFinite(body.stakeCents)
        ? Math.floor(body.stakeCents)
        : undefined;
    await enforceAntiSpamPolicy(c, issuerId, "task_creation", providedStakeCents);

    const task = await container.pactTasks.createTask({
      title: String(body.title),
      description: String(body.description),
      issuerId,
      paymentCents: Number(body.paymentCents),
      location: body.location,
      constraints: body.constraints,
    });
    await container.pactAntiSpam.recordAction(issuerId, "task_creation");
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

  app.post("/missions", async (c) => {
    const body = await c.req.json();
    const mission = await container.pactMissions.createMission({
      issuerId: String(body.issuerId),
      title: String(body.title),
      budgetCents: Number(body.budgetCents),
      context: body.context,
      compensationModel: body.compensationModel,
      targetAgentIds: Array.isArray(body.targetAgentIds) ? body.targetAgentIds.map(String) : [],
      maxRetries: typeof body.maxRetries === "number" ? body.maxRetries : undefined,
    });
    return c.json(mission, 201);
  });

  app.get("/missions", async (c) => {
    return c.json(await container.pactMissions.listMissions());
  });

  app.get("/missions/:id", async (c) => {
    return c.json(await container.pactMissions.getMission(c.req.param("id")));
  });

  app.post("/missions/:id/claim", async (c) => {
    const body = await c.req.json();
    const mission = await container.pactMissions.claimMission(c.req.param("id"), String(body.agentId));
    return c.json(mission);
  });

  app.post("/missions/:id/steps", async (c) => {
    const body = await c.req.json();
    const kind = String(body.kind);
    if (!isExecutionStepKind(kind)) {
      throw new HTTPException(400, { message: "Invalid execution step kind" });
    }

    const step = await container.pactMissions.appendExecutionStep({
      missionId: c.req.param("id"),
      agentId: String(body.agentId),
      kind,
      summary: String(body.summary),
      inputHash: body.inputHash ? String(body.inputHash) : undefined,
      outputHash: body.outputHash ? String(body.outputHash) : undefined,
    });
    return c.json(step, 201);
  });

  app.post("/missions/:id/evidence", async (c) => {
    const body = await c.req.json();
    const evidence = await container.pactMissions.submitEvidenceBundle({
      missionId: c.req.param("id"),
      agentId: String(body.agentId),
      summary: String(body.summary),
      artifactUris: Array.isArray(body.artifactUris) ? body.artifactUris.map(String) : [],
      bundleHash: String(body.bundleHash),
      stepId: body.stepId ? String(body.stepId) : undefined,
      signature: body.signature ? String(body.signature) : undefined,
    });
    return c.json(evidence, 201);
  });

  app.post("/missions/:id/verdict", async (c) => {
    const body = await c.req.json();
    const verdict = await container.pactMissions.recordVerdict({
      missionId: c.req.param("id"),
      reviewerId: String(body.reviewerId),
      approve: Boolean(body.approve),
      confidence: Number(body.confidence),
      notes: body.notes ? String(body.notes) : undefined,
      challengeStakeCents:
        typeof body.challengeStakeCents === "number" ? body.challengeStakeCents : undefined,
      challengeCounterpartyId: body.challengeCounterpartyId
        ? String(body.challengeCounterpartyId)
        : undefined,
    });
    return c.json(verdict, 201);
  });

  app.post("/missions/:id/challenges", async (c) => {
    const body = await c.req.json();
    const reason = String(body.reason);
    if (!isMissionChallengeReason(reason)) {
      throw new HTTPException(400, { message: "Invalid mission challenge reason" });
    }

    const mission = await container.pactMissions.openMissionChallenge({
      missionId: c.req.param("id"),
      challengerId: String(body.challengerId),
      counterpartyId: String(body.counterpartyId),
      reason,
      stakeAmountCents: typeof body.stakeAmountCents === "number" ? body.stakeAmountCents : undefined,
      triggeredByVerdictIds: Array.isArray(body.triggeredByVerdictIds)
        ? body.triggeredByVerdictIds.map(String)
        : undefined,
      notes: body.notes ? String(body.notes) : undefined,
    });
    return c.json(mission, 201);
  });

  app.post("/missions/:id/challenges/:challengeId/resolve", async (c) => {
    const body = await c.req.json();
    const mission = await container.pactMissions.resolveMissionChallenge({
      missionId: c.req.param("id"),
      challengeId: c.req.param("challengeId"),
      resolverId: String(body.resolverId),
      approve: Boolean(body.approve),
      notes: body.notes ? String(body.notes) : undefined,
    });
    return c.json(mission);
  });

  app.post("/pay/route", async (c) => {
    const body = await c.req.json();
    const route = await container.pactPay.routePayment(
      body.fromId ? String(body.fromId) : body.from ? String(body.from) : "",
      body.toId ? String(body.toId) : body.to ? String(body.to) : "",
      typeof body.amount === "number"
        ? body.amount
        : typeof body.amountCents === "number"
          ? body.amountCents
          : Number(body.amount),
      body.currency ? String(body.currency) : "USD",
      body.reference ? String(body.reference) : body.ref ? String(body.ref) : "",
    );
    return c.json(route, 201);
  });

  app.post("/pay/x402/relay", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const receipt = await container.pactPay.relayPayment(
      body.fromId ? String(body.fromId) : body.from ? String(body.from) : "",
      body.toId ? String(body.toId) : body.to ? String(body.to) : "",
      typeof body.amountCents === "number"
        ? body.amountCents
        : typeof body.amount === "number"
          ? body.amount
          : Number(body.amount),
      body.gasSponsored === true,
    );
    return c.json(receipt, 201);
  });

  app.get("/pay/x402/gas-stats/:beneficiaryId", async (c) => {
    return c.json(await container.pactPay.getX402SponsoredGasStats(c.req.param("beneficiaryId")));
  });

  app.get("/pay/routes", async (c) => {
    return c.json(await container.pactPay.listRoutes());
  });

  app.post("/pay/micropayments", async (c) => {
    const body = await c.req.json();
    await container.pactPay.addMicropayment(
      body.payerId ? String(body.payerId) : "",
      body.payeeId ? String(body.payeeId) : "",
      typeof body.amountCents === "number" ? body.amountCents : Number(body.amount),
    );
    return c.json({ accepted: true }, 201);
  });

  app.post("/pay/micropayments/flush", async (c) => {
    const body = await c.req.json();
    const batch = await container.pactPay.flushMicropayments(
      body.payerId ? String(body.payerId) : "",
    );
    return c.json(batch);
  });

  app.post("/pay/credit-lines", async (c) => {
    const body = await c.req.json();
    const line = await container.pactPay.openCreditLine(
      body.issuerId ? String(body.issuerId) : "",
      body.borrowerId ? String(body.borrowerId) : "",
      Number(body.limitCents),
      Number(body.interestBps),
    );
    return c.json(line, 201);
  });

  app.post("/pay/credit-lines/:id/use", async (c) => {
    const body = await c.req.json();
    const line = await container.pactPay.useCreditLine(
      c.req.param("id"),
      typeof body.amountCents === "number" ? body.amountCents : Number(body.amount),
    );
    return c.json(line);
  });

  app.post("/pay/credit-lines/:id/repay", async (c) => {
    const body = await c.req.json();
    const line = await container.pactPay.repayCreditLine(
      c.req.param("id"),
      typeof body.amountCents === "number" ? body.amountCents : Number(body.amount),
    );
    return c.json(line);
  });

  app.post("/pay/gas-sponsorship", async (c) => {
    const body = await c.req.json();
    const grant = await container.pactPay.grantGasSponsorship(
      body.sponsorId ? String(body.sponsorId) : "",
      body.beneficiaryId ? String(body.beneficiaryId) : "",
      Number(body.maxGasCents),
    );
    return c.json(grant, 201);
  });

  app.post("/pay/gas-sponsorship/:id/use", async (c) => {
    const body = await c.req.json();
    const grant = await container.pactPay.useGasSponsorship(
      c.req.param("id"),
      typeof body.gasCents === "number" ? body.gasCents : Number(body.gas),
    );
    return c.json(grant);
  });

  app.get("/payments/ledger", async (c) => {
    return c.json(await container.pactPay.ledger());
  });

  app.get("/compute/providers", async (c) => {
    return c.json(await container.pactCompute.listProviders());
  });

  app.get("/compute/adapters/health", async (c) => {
    return c.json(await container.pactCompute.getAdapterHealth());
  });

  app.get("/compute/backends/health", async (c) => {
    return c.json(await container.pactCompute.getManagedBackendHealth());
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

  app.get("/data/adapters/health", async (c) => {
    return c.json(await container.pactData.getAdapterHealth());
  });

  app.get("/data/backends/health", async (c) => {
    return c.json(await container.pactData.getManagedBackendHealth());
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

    const assetId = String(body.assetId);
    const asset = await container.pactData.getById(assetId);
    if (!asset) {
      throw new HTTPException(404, { message: `Asset ${assetId} not found` });
    }

    const providedStakeCents =
      typeof body.stakeCents === "number" && Number.isFinite(body.stakeCents)
        ? Math.floor(body.stakeCents)
        : undefined;
    await enforceAntiSpamPolicy(c, asset.ownerId, "data_listing", providedStakeCents);

    const listing = await container.pactData.listAsset(
      assetId,
      Number(body.priceCents),
      body.category,
    );
    await container.pactAntiSpam.recordAction(asset.ownerId, "data_listing");
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

  app.get("/economics/token/distribution", async (c) => {
    const distribution = getDistribution();
    const totalAllocated = distribution.reduce((sum, allocation) => sum + allocation.allocationAmount, 0);
    return c.json({
      token: TOKENOMICS_MODEL.token,
      distribution,
      totalAllocated,
    });
  });

  app.get("/economics/token/supply", async (c) => {
    const monthsQuery = c.req.query("months");
    const months = monthsQuery === undefined ? 12 : Number(monthsQuery);
    if (!Number.isInteger(months) || months < 1 || months > 120) {
      throw new HTTPException(400, {
        message: "months must be an integer between 1 and 120",
      });
    }

    const asOf = Date.now();
    return c.json({
      token: TOKENOMICS_MODEL.token,
      asOf,
      months,
      circulatingSupply: calculateCirculatingSupply(asOf),
      projections: projectTokenSupply(months),
    });
  });

  app.post("/economics/token/apy", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const totalStaked = getRequiredNumberField(body, "totalStaked");
    const emissionRate = getRequiredNumberField(body, "emissionRate");
    if (totalStaked < 0 || emissionRate < 0) {
      throw new HTTPException(400, {
        message: "totalStaked and emissionRate must be non-negative numbers",
      });
    }

    return c.json({
      totalStaked,
      emissionRate,
      apy: calculateStakingAPY(totalStaked, emissionRate),
    });
  });

  app.post("/economics/token/burn-rate", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const transactionVolume = getRequiredNumberField(body, "transactionVolume");
    const burnPercent = getRequiredNumberField(body, "burnPercent");
    if (transactionVolume < 0) {
      throw new HTTPException(400, { message: "transactionVolume must be non-negative" });
    }
    if (burnPercent < 0 || burnPercent > 100) {
      throw new HTTPException(400, { message: "burnPercent must be between 0 and 100" });
    }

    const burnedAmount = calculateBurnRate(transactionVolume, burnPercent);
    return c.json({
      transactionVolume,
      burnPercent,
      burnedAmount,
      netVolume: transactionVolume - burnedAmount,
    });
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
    const idempotencyHeader = c.req.header("Idempotency-Key") ?? c.req.header("idempotency-key");
    const idempotencyKey = idempotencyHeader ?? (body.idempotencyKey ? String(body.idempotencyKey) : undefined);
    if (!idempotencyKey) {
      throw new HTTPException(400, {
        message: "Idempotency-Key header or idempotencyKey body field is required",
      });
    }

    const result = await container.pactEconomics.executeSettlement({
      model: body.model,
      settlementId: body.settlementId ? String(body.settlementId) : undefined,
      idempotencyKey,
    });
    return c.json(result, 201);
  });

  app.get("/economics/connectors/health", async (c) => {
    return c.json(container.pactReconciliation.getConnectorHealth());
  });

  app.post("/economics/connectors/:connectorId/reset", async (c) => {
    const connectorId = c.req.param("connectorId");
    if (!isSettlementRecordConnector(connectorId)) {
      throw new HTTPException(404, { message: "Connector not found" });
    }

    return c.json(container.pactEconomics.resetConnectorHealth(connectorId));
  });

  app.post("/economics/reconciliation/run", async (c) => {
    return c.json(await container.pactReconciliation.runReconciliationCycle(), 201);
  });

  app.get("/economics/reconciliation/summary", async (c) => {
    return c.json(await container.pactReconciliation.getReconciliationSummary());
  });

  app.get("/economics/reconciliation/unreconciled", async (c) => {
    return c.json(await container.pactReconciliation.listUnreconciledSettlements());
  });

  app.get("/economics/reconciliation/queue", async (c) => {
    const stateValue = c.req.query("state");
    if (stateValue && !isReconciliationQueueState(stateValue)) {
      throw new HTTPException(400, { message: "Invalid reconciliation queue state" });
    }
    const state = isReconciliationQueueState(stateValue) ? stateValue : undefined;

    const connectorValue = c.req.query("connector");
    if (connectorValue && !isSettlementRecordConnector(connectorValue)) {
      throw new HTTPException(400, { message: "Invalid settlement connector" });
    }
    const connector = isSettlementRecordConnector(connectorValue) ? connectorValue : undefined;

    return c.json(
      await container.pactReconciliation.listReconciliationQueue({
        state,
        connector,
        settlementId: c.req.query("settlementId"),
        idempotencyKey: c.req.query("idempotencyKey"),
        cursor: c.req.query("cursor"),
        limit: parseOptionalBoundedIntegerQuery(c.req.query("limit"), "limit", 1, 200),
      }),
    );
  });

  app.get("/economics/reconciliation/pending", async (c) => {
    const stateValue = c.req.query("state");
    if (stateValue && !isReconciliationQueueState(stateValue)) {
      throw new HTTPException(400, { message: "Invalid reconciliation queue state" });
    }
    const state = isReconciliationQueueState(stateValue) ? stateValue : undefined;

    const connectorValue = c.req.query("connector");
    if (connectorValue && !isSettlementRecordConnector(connectorValue)) {
      throw new HTTPException(400, { message: "Invalid settlement connector" });
    }
    const connector = isSettlementRecordConnector(connectorValue) ? connectorValue : undefined;

    return c.json(
      await container.pactReconciliation.listReconciliationQueue({
        state,
        connector,
        settlementId: c.req.query("settlementId"),
        idempotencyKey: c.req.query("idempotencyKey"),
        cursor: c.req.query("cursor"),
        limit: parseOptionalBoundedIntegerQuery(c.req.query("limit"), "limit", 1, 200),
      }),
    );
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
    const page = await container.pactEconomics.querySettlementRecords({
      settlementId: c.req.query("settlementId"),
      assetId: c.req.query("assetId"),
      rail,
      payerId: c.req.query("payerId"),
      payeeId: c.req.query("payeeId"),
      status,
      reconciledBy: c.req.query("reconciledBy"),
      cursor: c.req.query("cursor"),
      limit: parseOptionalBoundedIntegerQuery(c.req.query("limit"), "limit", 1, 200),
    });
    return c.json(page);
  });

  app.get("/economics/settlements/records/replay", async (c) => {
    const replay = await container.pactEconomics.replaySettlementRecordLifecycle({
      fromOffset: parseOptionalMinimumIntegerQuery(c.req.query("fromOffset"), "fromOffset", 0),
      limit: parseOptionalBoundedIntegerQuery(c.req.query("limit"), "limit", 1, 500),
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

  app.post("/governance/proposals", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const proposal = await container.pactOnchain.createGovernanceProposal({
      proposerId: body.proposerId ? String(body.proposerId) : "",
      title: body.title ? String(body.title) : "",
      description: body.description ? String(body.description) : "",
      quorum:
        typeof body.quorum === "number" && Number.isFinite(body.quorum)
          ? Math.floor(body.quorum)
          : undefined,
      votingStartsAt:
        typeof body.votingStartsAt === "number" && Number.isFinite(body.votingStartsAt)
          ? Math.floor(body.votingStartsAt)
          : undefined,
      votingEndsAt: getRequiredNumberField(body, "votingEndsAt"),
      actions: Array.isArray(body.actions)
        ? body.actions.map((action: unknown) => {
            const payload = action && typeof action === "object"
              ? (action as Record<string, unknown>)
              : {};
            return {
              target: payload.target ? String(payload.target) : "",
              signature: payload.signature ? String(payload.signature) : "",
              calldata: payload.calldata ? String(payload.calldata) : "0x",
              value:
                typeof payload.value === "number" && Number.isFinite(payload.value)
                  ? Math.floor(payload.value)
                  : 0,
              description: payload.description ? String(payload.description) : undefined,
            };
          })
        : [],
    });
    return c.json(proposal, 201);
  });

  app.get("/onchain/finality/summary", async (c) => {
    return c.json(container.pactOnchain.getFinalitySummary());
  });

  app.get("/onchain/finality/transactions", async (c) => {
    const statusValue = c.req.query("status");
    if (statusValue && !isOnchainTransactionStatus(statusValue) && statusValue !== "all") {
      throw new HTTPException(400, { message: "Invalid onchain transaction status" });
    }
    const status = statusValue === "all" || isOnchainTransactionStatus(statusValue)
      ? statusValue
      : undefined;

    const operationValue = c.req.query("operation");
    if (operationValue && !isOnchainTransactionOperation(operationValue)) {
      throw new HTTPException(400, { message: "Invalid onchain transaction operation" });
    }
    const operation = isOnchainTransactionOperation(operationValue) ? operationValue : undefined;

    return c.json(container.pactOnchain.listTransactions({
      status,
      operation,
      participantId: c.req.query("participantId"),
      proposalId: c.req.query("proposalId"),
      referenceId: c.req.query("referenceId"),
      epoch: parseOptionalMinimumIntegerQuery(c.req.query("epoch"), "epoch", 0),
      cursor: c.req.query("cursor"),
      limit: parseOptionalBoundedIntegerQuery(c.req.query("limit"), "limit", 1, 200),
    }));
  });

  app.get("/onchain/finality/transactions/:txId", async (c) => {
    const transaction = container.pactOnchain.getTransaction(c.req.param("txId"));
    if (!transaction) {
      throw new HTTPException(404, { message: "Onchain transaction not found" });
    }
    return c.json(transaction);
  });

  app.post("/governance/proposals/:id/vote", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const choice = parseGovernanceVoteChoice(body.choice, body.support);
    if (!choice) {
      throw new HTTPException(400, { message: "choice or support is required" });
    }

    const proposal = await container.pactOnchain.voteGovernanceProposal({
      proposalId: c.req.param("id"),
      voterId: body.voterId ? String(body.voterId) : "",
      choice,
      weight:
        typeof body.weight === "number" && Number.isFinite(body.weight)
          ? Math.floor(body.weight)
          : undefined,
    });
    return c.json(proposal);
  });

  app.post("/governance/proposals/:id/execute", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const proposal = await container.pactOnchain.executeGovernanceProposal({
      proposalId: c.req.param("id"),
      executorId: body.executorId ? String(body.executorId) : "system-governance-executor",
    });
    return c.json(proposal);
  });

  app.post("/rewards/epochs/:epoch/distribute", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const epoch = Number(c.req.param("epoch"));
    if (!Number.isInteger(epoch) || epoch < 0) {
      throw new HTTPException(400, { message: "epoch must be a non-negative integer" });
    }

    const distributionsInput = Array.isArray(body.distributions)
      ? body.distributions
      : Array.isArray(body.rewards)
        ? body.rewards
        : [];
    const distributions = distributionsInput.map((distribution: unknown) => {
      const payload = distribution && typeof distribution === "object"
        ? (distribution as Record<string, unknown>)
        : {};
      return {
        participantId: payload.participantId ? String(payload.participantId) : "",
        amountCents:
          typeof payload.amountCents === "number"
            ? payload.amountCents
            : typeof payload.amount === "number"
              ? payload.amount
              : Number(payload.amountCents ?? payload.amount),
      };
    });

    const result = await container.pactOnchain.syncEpochRewards(epoch, distributions);
    return c.json(result, 201);
  });

  app.get("/rewards/:participantId", async (c) => {
    return c.json(await container.pactOnchain.getParticipantRewards(c.req.param("participantId")));
  });

  app.post("/dev/plugins/publish", async (c) => {
    const body = await c.req.json();
    const plugin = await container.pactPluginMarketplace.publishPlugin({
      developerId: String(body.developerId),
      name: String(body.name),
      version: String(body.version),
      description: String(body.description),
      repositoryUrl: body.repositoryUrl ? String(body.repositoryUrl) : String(body.repoUrl),
      priceCents:
        typeof body.priceCents === "number" ? body.priceCents : Number(body.priceCents),
    });
    return c.json(plugin, 201);
  });

  app.get("/dev/plugins", async (c) => {
    return c.json(await container.pactPluginMarketplace.listPlugins());
  });

  app.post("/dev/plugins/:id/install", async (c) => {
    const body = await c.req.json();
    const install = await container.pactPluginMarketplace.installPlugin(
      c.req.param("id"),
      body.installerId ? String(body.installerId) : "",
    );
    return c.json(install, 201);
  });

  app.post("/dev/plugins/:id/revenue", async (c) => {
    const body = await c.req.json();
    const revenue = await container.pactPluginMarketplace.recordPluginRevenue(
      c.req.param("id"),
      typeof body.revenueCents === "number" ? body.revenueCents : Number(body.revenueCents),
    );
    return c.json(revenue, 201);
  });

  app.get("/dev/plugins/payouts/:developerId", async (c) => {
    const payouts = await container.pactPluginMarketplace.getDeveloperPayouts(
      c.req.param("developerId"),
    );
    return c.json(payouts);
  });

  app.get("/dev/integrations", async (c) => {
    return c.json(await container.pactDev.list());
  });

  app.get("/dev/integrations/health", async (c) => {
    return c.json(await container.pactDev.listIntegrationHealth());
  });

  app.get("/dev/backends/health", async (c) => {
    return c.json(await container.pactDev.getManagedBackendHealth());
  });

  app.post("/dev/integrations", async (c) => {
    const body = await c.req.json();
    const integration = await container.pactDev.register({
      ownerId: String(body.ownerId),
      name: String(body.name),
      webhookUrl: String(body.webhookUrl),
      version: body.version ? String(body.version) : undefined,
      supportedCoreVersions: Array.isArray(body.supportedCoreVersions)
        ? body.supportedCoreVersions.map(String)
        : undefined,
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

  app.post("/disputes", async (c) => {
    const body = await c.req.json();
    const initialEvidence = body.initialEvidence && typeof body.initialEvidence === "object"
      ? (body.initialEvidence as Record<string, unknown>)
      : {};

    const dispute = await container.pactDisputes.openDispute(
      String(body.missionId),
      String(body.challengerId),
      {
        description: String(initialEvidence.description ?? ""),
        artifactUris: Array.isArray(initialEvidence.artifactUris)
          ? initialEvidence.artifactUris.map((uri) => String(uri))
          : [],
      },
    );

    return c.json(dispute, 201);
  });

  app.get("/disputes", async (c) => {
    const status = c.req.query("status");
    if (status && !isDisputeStatus(status)) {
      throw new HTTPException(400, { message: "Invalid dispute status" });
    }

    return c.json(await container.pactDisputes.listDisputes(status));
  });

  app.get("/disputes/:id", async (c) => {
    return c.json(await container.pactDisputes.getDispute(c.req.param("id")));
  });

  app.post("/disputes/:id/evidence", async (c) => {
    const body = await c.req.json();
    const dispute = await container.pactDisputes.submitEvidence(
      c.req.param("id"),
      String(body.submitterId),
      {
        description: String(body.description ?? ""),
        artifactUris: Array.isArray(body.artifactUris)
          ? body.artifactUris.map((uri: unknown) => String(uri))
          : [],
      },
    );

    return c.json(dispute);
  });

  app.post("/disputes/:id/vote", async (c) => {
    const body = await c.req.json();
    const vote = body.vote === "uphold" ? "uphold" : body.vote === "reject" ? "reject" : undefined;
    if (!vote) {
      throw new HTTPException(400, { message: "Invalid jury vote value" });
    }

    const dispute = await container.pactDisputes.castJuryVote(
      c.req.param("id"),
      String(body.jurorId),
      vote,
      String(body.reasoning ?? ""),
    );

    return c.json(dispute);
  });

  app.post("/disputes/:id/resolve", async (c) => {
    return c.json(await container.pactDisputes.resolveDispute(c.req.param("id")));
  });

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return error.getResponse();
    }

    if (error instanceof AdapterOperationError) {
      return c.json(
        {
          error: error.name,
          message: error.message,
          code: error.code,
          retryable: error.retryable,
          adapter: error.adapter,
          operation: error.operation,
        },
        400,
      );
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

function resolveStatusCode(defaultStatusCode: number, error: unknown): number {
  if (error instanceof HTTPException) {
    return error.status;
  }
  if (error) {
    return 500;
  }
  return defaultStatusCode;
}

function resolveRoutePath(routePath: string | undefined, requestPath: string): string {
  if (routePath && routePath !== "*" && routePath !== "/*") {
    return routePath;
  }
  return requestPath;
}

function normalizeLimitValue(value: string | undefined, fallback: number, max: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(max, Math.floor(parsed));
}

function parseOptionalBoundedIntegerQuery(
  value: string | undefined,
  label: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HTTPException(400, {
      message: `${label} must be an integer between ${minimum} and ${maximum}`,
    });
  }

  return parsed;
}

function parseOptionalMinimumIntegerQuery(
  value: string | undefined,
  label: string,
  minimum: number,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new HTTPException(400, {
      message: `${label} must be an integer greater than or equal to ${minimum}`,
    });
  }

  return parsed;
}

function normalizeOffsetValue(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return Math.floor(parsed);
}

function isSettlementRail(
  value?: string,
): value is "llm_metering" | "cloud_billing" | "api_quota" {
  return value === "llm_metering" || value === "cloud_billing" || value === "api_quota";
}

function isAnalyticsPeriod(value?: string): value is AnalyticsPeriod {
  return value === "hour" || value === "day" || value === "week";
}

function parseGovernanceVoteChoice(
  value: unknown,
  support: unknown,
): "for" | "against" | "abstain" | undefined {
  if (value === "for" || value === "against" || value === "abstain") {
    return value;
  }
  if (typeof support === "boolean") {
    return support ? "for" : "against";
  }
  return undefined;
}

function isSettlementRecordStatus(value?: string): value is "applied" | "reconciled" {
  return value === "applied" || value === "reconciled";
}

function isSettlementRecordConnector(
  value?: string,
): value is "llm_token_metering" | "cloud_credit_billing" | "api_quota_allocation" {
  return (
    value === "llm_token_metering" ||
    value === "cloud_credit_billing" ||
    value === "api_quota_allocation"
  );
}

function isReconciliationQueueState(value?: string): value is "pending" | "failed" | "all" {
  return value === "pending" || value === "failed" || value === "all";
}

function isOnchainTransactionStatus(
  value?: string,
): value is "submitted" | "confirmed" | "finalized" | "reorged" {
  return value === "submitted" || value === "confirmed" || value === "finalized" || value === "reorged";
}

function isOnchainTransactionOperation(
  value?: string,
): value is
  | "governance_proposal_create"
  | "governance_proposal_vote"
  | "governance_proposal_execute"
  | "rewards_epoch_sync"
  | "rewards_claim_sync" {
  return (
    value === "governance_proposal_create" ||
    value === "governance_proposal_vote" ||
    value === "governance_proposal_execute" ||
    value === "rewards_epoch_sync" ||
    value === "rewards_claim_sync"
  );
}

function rethrowParticipantNotFound(error: unknown): never {
  if (error instanceof ParticipantNotFoundError) {
    throw new HTTPException(404, { message: error.message });
  }
  throw error;
}

function isAntiSpamAction(value?: string): value is AntiSpamAction {
  return value === "task_creation" || value === "bid_submission" || value === "data_listing";
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

function isReputationCategory(value?: string): value is ReputationCategory {
  return (
    value === "task_completion" ||
    value === "verification_accuracy" ||
    value === "payment_reliability" ||
    value === "responsiveness" ||
    value === "skill_expertise"
  );
}

function isDisputeStatus(value?: string): value is DisputeStatus {
  return (
    value === "open" ||
    value === "evidence" ||
    value === "jury_vote" ||
    value === "resolved"
  );
}

function isExecutionStepKind(
  value?: string,
): value is "tool_call" | "artifact_produced" | "decision" | "external_action" {
  return (
    value === "tool_call" ||
    value === "artifact_produced" ||
    value === "decision" ||
    value === "external_action"
  );
}

function isMissionChallengeReason(
  value?: string,
): value is "verdict_disagreement" | "low_confidence" | "manual_escalation" {
  return value === "verdict_disagreement" || value === "low_confidence" || value === "manual_escalation";
}

function isZKProofType(value?: string): value is ZKProofType {
  return value === "location" || value === "completion" || value === "identity" || value === "reputation";
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

function getRequiredNumberField(body: unknown, fieldName: string): number {
  if (!body || typeof body !== "object") {
    throw new HTTPException(400, { message: `${fieldName} is required` });
  }

  const candidate = (body as Record<string, unknown>)[fieldName];
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    throw new HTTPException(400, {
      message: `${fieldName} must be a finite number`,
    });
  }

  return candidate;
}
