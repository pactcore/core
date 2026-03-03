import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createContainer } from "../application/container";
import type { ValidationConfig } from "../domain/validation-pipeline";
import type { TaskEvidence } from "../domain/types";

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

  app.post("/data/assets", async (c) => {
    const body = await c.req.json();
    const asset = await container.pactData.publish({
      ownerId: String(body.ownerId),
      title: String(body.title),
      uri: String(body.uri),
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
    });
    return c.json(asset, 201);
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

  app.post("/dev/integrations", async (c) => {
    const body = await c.req.json();
    const integration = await container.pactDev.register({
      ownerId: String(body.ownerId),
      name: String(body.name),
      webhookUrl: String(body.webhookUrl),
    });
    return c.json(integration, 201);
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
