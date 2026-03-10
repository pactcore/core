import { describe, expect, it } from "bun:test";
import {
  createManagedBackendProfile,
  loadManagedBackendProfileFromEnv,
  normalizeManagedBackendConfiguredCredentialFields,
  normalizeManagedBackendCredentialSchemaFields,
  normalizeManagedBackendRequiredCredentialFields,
} from "../src";
import { createApp } from "../src/api/app";
import { createContainer } from "../src/application/container";
import { RemoteHttpManagedObservabilityAdapterSkeleton } from "../src/infrastructure/managed/remote-http-managed-observability-adapter-skeleton";
import { RemoteHttpManagedQueueAdapterSkeleton } from "../src/infrastructure/managed/remote-http-managed-queue-adapter-skeleton";
import { RemoteHttpManagedStoreAdapterSkeleton } from "../src/infrastructure/managed/remote-http-managed-store-adapter-skeleton";

describe("managed backend contracts", () => {
  it("exposes local backend health surfaces for data, compute, and dev", async () => {
    const app = createApp();

    const dataResponse = await app.request("/data/backends/health");
    const dataBody = (await dataResponse.json()) as {
      status: string;
      backends: Array<{ capability: string; mode: string; name: string }>;
    };

    const computeResponse = await app.request("/compute/backends/health");
    const computeBody = (await computeResponse.json()) as {
      status: string;
      backends: Array<{ capability: string; mode: string; name: string }>;
    };

    const devResponse = await app.request("/dev/backends/health");
    const devBody = (await devResponse.json()) as {
      status: string;
      backends: Array<{ capability: string; mode: string; name: string }>;
    };

    expect(dataResponse.status).toBe(200);
    expect(computeResponse.status).toBe(200);
    expect(devResponse.status).toBe(200);

    expect(dataBody.backends.map((entry) => entry.capability)).toEqual([
      "queue",
      "store",
      "observability",
    ]);
    expect(computeBody.backends.map((entry) => entry.capability)).toEqual([
      "queue",
      "store",
      "observability",
    ]);
    expect(devBody.backends.map((entry) => entry.capability)).toEqual([
      "queue",
      "store",
      "observability",
    ]);

    expect(dataBody.backends.every((entry) => entry.mode === "local")).toBeTrue();
    expect(computeBody.backends.every((entry) => entry.mode === "local")).toBeTrue();
    expect(devBody.backends.every((entry) => entry.mode === "local")).toBeTrue();
    expect(dataBody.status).toBe("degraded");
    expect(computeBody.status).toBe("healthy");
    expect(devBody.status).toBe("healthy");
  });

  it("supports remote queue skeletons without replacing local compute adapters", async () => {
    const queue = new RemoteHttpManagedQueueAdapterSkeleton({
      domain: "compute",
      profile: {
        backendId: "managed-compute-queue",
        providerId: "managed-compute",
        displayName: "Managed Compute Queue",
        endpoint: "https://managed.example.com/compute/queue",
        timeoutMs: 2_000,
        credentialSchema: {
          type: "bearer",
          fields: [{ key: "token", required: true, secret: true }],
        },
        configuredCredentialFields: ["token"],
      },
    });
    const container = createContainer(undefined, {
      managedBackends: {
        compute: {
          queue,
        },
      },
    });

    const receipt = await queue.enqueue({
      id: "job-managed-1",
      topic: "compute.exec",
      payload: { image: "busybox", command: "echo ok" },
      createdAt: Date.now(),
    });
    const app = createApp(undefined, { container });

    const response = await app.request("/compute/backends/health");
    const body = (await response.json()) as {
      status: string;
      backends: Array<{
        capability: string;
        mode: string;
        state: string;
        profile?: { endpoint?: string; credentialType?: string; requiredCredentialFields?: string[] };
        features?: Record<string, boolean | number | string>;
      }>;
    };
    const queueHealth = body.backends.find((entry) => entry.capability === "queue");
    const adapterHealthResponse = await app.request("/compute/adapters/health");
    const adapterHealth = (await adapterHealthResponse.json()) as {
      adapters: Array<{ name: string; features?: Record<string, boolean> }>;
    };
    const executionAdapter = adapterHealth.adapters.find(
      (entry) => entry.name === "compute-execution-adapter",
    );

    expect(receipt.state).toBe("queued");
    expect(response.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(queueHealth?.mode).toBe("remote");
    expect(queueHealth?.state).toBe("healthy");
    expect(queueHealth?.profile?.endpoint).toBe("https://managed.example.com/compute/queue");
    expect(queueHealth?.profile?.credentialType).toBe("bearer");
    expect(queueHealth?.profile?.requiredCredentialFields).toEqual(["token"]);
    expect(queueHealth?.features?.skeleton).toBe(true);
    expect(queueHealth?.features?.queuedMessages).toBe(1);
    expect(adapterHealthResponse.status).toBe(200);
    expect(executionAdapter?.features?.runtimeAware).toBe(true);
  });

  it("supports remote store and observability skeleton contracts across data and dev backends", async () => {
    const dataStore = new RemoteHttpManagedStoreAdapterSkeleton<string>({
      domain: "data",
      profile: {
        backendId: "managed-data-store",
        providerId: "managed-data",
        displayName: "Managed Data Store",
        endpoint: "https://managed.example.com/data/store",
        timeoutMs: 2_000,
        credentialSchema: {
          type: "api_key",
          fields: [{ key: "apiKey", required: true, secret: true }],
        },
        configuredCredentialFields: ["apiKey"],
      },
    });
    const devObservability = new RemoteHttpManagedObservabilityAdapterSkeleton({
      domain: "dev",
      profile: {
        backendId: "managed-dev-observability",
        providerId: "managed-dev",
        displayName: "Managed Dev Observability",
        endpoint: "https://managed.example.com/dev/observability",
        timeoutMs: 2_000,
        credentialSchema: {
          type: "bearer",
          fields: [{ key: "token", required: true, secret: true }],
        },
        configuredCredentialFields: ["token"],
      },
    });
    const container = createContainer(undefined, {
      managedBackends: {
        data: {
          store: dataStore,
        },
        dev: {
          observability: devObservability,
        },
      },
    });

    await dataStore.put({
      key: "asset:1",
      value: "cid://asset-1",
      updatedAt: 1_710_000_000_000,
    });
    const stored = await dataStore.get("asset:1");
    await dataStore.put({
      key: "asset:2",
      value: "cid://asset-2",
      updatedAt: 1_710_000_000_001,
    });
    await dataStore.put({
      key: "log:1",
      value: "cid://log-1",
      updatedAt: 1_710_000_000_002,
    });
    const page = await dataStore.list({ prefix: "asset:", limit: 1 });
    const terminalPage = await dataStore.list({ prefix: "asset:2", limit: 1 });
    await expect(dataStore.put({
      key: "asset:1",
      value: "cid://asset-1b",
      updatedAt: 1_710_000_000_003,
    }, {
      expectedEtag: "sha256:stale",
    })).rejects.toThrow("managed store etag mismatch");
    await devObservability.recordMetric({
      name: "integration.deployments",
      type: "counter",
      value: 2,
      recordedAt: 1_710_000_000_000,
      labels: {
        integration: "sdk-template",
      },
    });
    await devObservability.recordTrace({
      traceId: "trace-1",
      spanId: "span-1",
      name: "integration.publish",
      startedAt: 1_710_000_000_000,
      endedAt: 1_710_000_000_010,
      status: "ok",
      attributes: {
        integrationId: "dev-1",
      },
    });
    await devObservability.flush();

    const app = createApp(undefined, { container });
    const dataResponse = await app.request("/data/backends/health");
    const dataBody = (await dataResponse.json()) as {
      status: string;
      backends: Array<{
        capability: string;
        mode: string;
        state: string;
        profile?: { endpoint?: string; credentialType?: string; requiredCredentialFields?: string[] };
        features?: Record<string, boolean | number | string>;
      }>;
    };
    const devResponse = await app.request("/dev/backends/health");
    const devBody = (await devResponse.json()) as {
      status: string;
      backends: Array<{
        capability: string;
        mode: string;
        state: string;
        profile?: { endpoint?: string; credentialType?: string; requiredCredentialFields?: string[] };
        features?: Record<string, boolean | number | string>;
      }>;
    };

    const dataStoreHealth = dataBody.backends.find((entry) => entry.capability === "store");
    const devObservabilityHealth = devBody.backends.find((entry) => entry.capability === "observability");

    expect(stored?.value).toBe("cid://asset-1");
    expect(stored?.etag?.startsWith("sha256:")).toBe(true);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.key).toBe("asset:1");
    expect(page.nextCursor).toBe("asset:1");
    expect(terminalPage.items).toHaveLength(1);
    expect(terminalPage.items[0]?.key).toBe("asset:2");
    expect(terminalPage.nextCursor).toBeUndefined();
    expect(dataResponse.status).toBe(200);
    expect(devResponse.status).toBe(200);
    expect(dataBody.status).toBe("healthy");
    expect(devBody.status).toBe("healthy");
    expect(dataStoreHealth?.mode).toBe("remote");
    expect(dataStoreHealth?.state).toBe("healthy");
    expect(dataStoreHealth?.profile?.endpoint).toBe("https://managed.example.com/data/store");
    expect(dataStoreHealth?.profile?.credentialType).toBe("api_key");
    expect(dataStoreHealth?.features?.skeleton).toBe(true);
    expect(dataStoreHealth?.features?.storedRecords).toBe(3);
    expect(devObservabilityHealth?.mode).toBe("remote");
    expect(devObservabilityHealth?.state).toBe("healthy");
    expect(devObservabilityHealth?.profile?.endpoint).toBe("https://managed.example.com/dev/observability");
    expect(devObservabilityHealth?.profile?.credentialType).toBe("bearer");
    expect(devObservabilityHealth?.features?.skeleton).toBe(true);
    expect(devObservabilityHealth?.features?.bufferedMetrics).toBe(0);
    expect(devObservabilityHealth?.features?.bufferedTraces).toBe(0);
    expect(devObservabilityHealth?.features?.flushCount).toBe(1);
  });

  it("exports managed backend credential normalization helpers through the public API", () => {
    expect(
      normalizeManagedBackendConfiguredCredentialFields(["access_token", "token"], "bearer"),
    ).toEqual(["token"]);
    expect(
      normalizeManagedBackendRequiredCredentialFields(
        [
          { key: "access_token", required: true, secret: true },
          { key: "project_id", required: false },
        ],
        "service_account",
      ),
    ).toEqual(["accessToken"]);
    expect(
      normalizeManagedBackendCredentialSchemaFields(
        [
          { key: "access_token", required: true, secret: true },
          { key: "project_id", required: false },
        ],
        "service_account",
      ),
    ).toEqual([
      { key: "accessToken", required: true, secret: true },
      { key: "projectId", required: false },
    ]);
  });

  it("exports managed backend profile loaders through the public API", () => {
    const profile = loadManagedBackendProfileFromEnv(
      {
        PACT_DEV_OBSERVABILITY_BACKEND_PROFILE_JSON: JSON.stringify({
          backendId: "managed-dev-observability",
          providerId: "managed-dev",
          credentialType: "service_account",
          configuredCredentialFields: ["email"],
        }),
        PACT_DEV_OBSERVABILITY_BACKEND_ENDPOINT: "https://managed.example.com/dev/observability",
        PACT_DEV_OBSERVABILITY_BACKEND_CREDENTIAL_PROJECT_ID: "managed-project",
      },
      {
        envPrefix: "PACT_DEV_OBSERVABILITY_BACKEND",
        defaultBackendId: "dev-observability-backend",
        defaultProviderId: "dev-observability",
        defaultDisplayName: "Dev observability backend",
      },
    );

    expect(profile).toEqual(
      createManagedBackendProfile(
        {
          backendId: "managed-dev-observability",
          providerId: "managed-dev",
          endpoint: "https://managed.example.com/dev/observability",
          credentialType: "service_account",
          configuredCredentialFields: ["clientEmail", "projectId"],
        },
        {
          defaultBackendId: "dev-observability-backend",
          defaultProviderId: "dev-observability",
          defaultDisplayName: "Dev observability backend",
        },
      ),
    );
  });

  it("routes PactData publications through managed queue, store, and observability adapters", async () => {
    const queue = new RemoteHttpManagedQueueAdapterSkeleton({
      domain: "data",
      profile: {
        backendId: "managed-data-queue",
        providerId: "managed-data",
        endpoint: "https://managed.example.com/data/queue",
        credentialSchema: {
          type: "bearer",
          fields: [{ key: "token", required: true, secret: true }],
        },
        configuredCredentialFields: ["token"],
      },
    });
    const store = new RemoteHttpManagedStoreAdapterSkeleton<unknown>({
      domain: "data",
      profile: {
        backendId: "managed-data-store",
        providerId: "managed-data",
        endpoint: "https://managed.example.com/data/store",
        credentialSchema: {
          type: "api_key",
          fields: [{ key: "apiKey", required: true, secret: true }],
        },
        configuredCredentialFields: ["apiKey"],
      },
    });
    const observability = new RemoteHttpManagedObservabilityAdapterSkeleton({
      domain: "data",
      profile: {
        backendId: "managed-data-observability",
        providerId: "managed-data",
        endpoint: "https://managed.example.com/data/observability",
        credentialSchema: {
          type: "bearer",
          fields: [{ key: "token", required: true, secret: true }],
        },
        configuredCredentialFields: ["token"],
      },
    });
    const container = createContainer(undefined, {
      managedBackends: {
        data: {
          queue,
          store,
          observability,
        },
      },
    });

    const asset = await container.pactData.publish({
      ownerId: "owner-1",
      title: "Managed asset",
      uri: "cid://managed-asset",
      tags: ["managed"],
      derivedFrom: ["asset-parent-1"],
    });
    const stored = await store.get(`asset:${asset.id}`);
    const backendHealth = await container.pactData.getManagedBackendHealth();
    const queueHealth = backendHealth.backends.find((entry) => entry.capability === "queue");
    const storeHealth = backendHealth.backends.find((entry) => entry.capability === "store");
    const observabilityHealth = backendHealth.backends.find((entry) => entry.capability === "observability");

    expect(queue.getDepth().available).toBe(1);
    expect(stored?.value).toMatchObject({
      asset: {
        id: asset.id,
        ownerId: "owner-1",
      },
      derivedFrom: ["asset-parent-1"],
    });
    expect(queueHealth?.features?.queuedMessages).toBe(1);
    expect(storeHealth?.features?.storedRecords).toBe(1);
    expect(observabilityHealth?.features?.bufferedMetrics).toBe(1);
    expect(observabilityHealth?.features?.bufferedTraces).toBe(1);
  });

  it("routes PactData marketplace and policy lifecycle through managed adapters", async () => {
    const queue = new RemoteHttpManagedQueueAdapterSkeleton({
      domain: "data",
      profile: {
        backendId: "managed-data-queue",
        providerId: "managed-data",
        endpoint: "https://managed.example.com/data/queue",
        credentialSchema: {
          type: "bearer",
          fields: [{ key: "token", required: true, secret: true }],
        },
        configuredCredentialFields: ["token"],
      },
    });
    const store = new RemoteHttpManagedStoreAdapterSkeleton<unknown>({
      domain: "data",
      profile: {
        backendId: "managed-data-store",
        providerId: "managed-data",
        endpoint: "https://managed.example.com/data/store",
        credentialSchema: {
          type: "api_key",
          fields: [{ key: "apiKey", required: true, secret: true }],
        },
        configuredCredentialFields: ["apiKey"],
      },
    });
    const observability = new RemoteHttpManagedObservabilityAdapterSkeleton({
      domain: "data",
      profile: {
        backendId: "managed-data-observability",
        providerId: "managed-data",
        endpoint: "https://managed.example.com/data/observability",
        credentialSchema: {
          type: "bearer",
          fields: [{ key: "token", required: true, secret: true }],
        },
        configuredCredentialFields: ["token"],
      },
    });
    const container = createContainer(undefined, {
      managedBackends: {
        data: {
          queue,
          store,
          observability,
        },
      },
    });

    const asset = await container.pactData.publish({
      ownerId: "seller-1",
      title: "Managed marketplace asset",
      uri: "cid://managed-marketplace-asset",
      derivedFrom: ["raw-parent-1"],
    });
    await container.pactData.setAccessPolicy(asset.id, ["seller-1"], false);
    const listing = await container.pactData.listAsset(asset.id, 950, "survey");
    const purchase = await container.pactData.purchaseAsset(listing.id, "buyer-1");
    await container.pactData.delistAsset(listing.id);

    const assetRecord = await store.get(`asset:${asset.id}`);
    const policyRecord = await store.get(`policy:${asset.id}`);
    const listingRecord = await store.get(`listing:${listing.id}`);
    const purchaseRecord = await store.get(`purchase:${purchase.id}`);
    const backendHealth = await container.pactData.getManagedBackendHealth();
    const queueHealth = backendHealth.backends.find((entry) => entry.capability === "queue");
    const storeHealth = backendHealth.backends.find((entry) => entry.capability === "store");
    const observabilityHealth = backendHealth.backends.find((entry) => entry.capability === "observability");

    expect(queue.getDepth().available).toBe(6);
    expect(assetRecord?.value).toMatchObject({
      accessPolicy: {
        assetId: asset.id,
        allowedParticipantIds: ["seller-1", "buyer-1"],
        isPublic: false,
      },
      derivedFrom: ["raw-parent-1"],
    });
    expect(policyRecord?.value).toEqual({
      assetId: asset.id,
      allowedParticipantIds: ["seller-1", "buyer-1"],
      isPublic: false,
    });
    expect(listingRecord?.value).toMatchObject({
      id: listing.id,
      assetId: asset.id,
      active: false,
      category: "survey",
    });
    expect(purchaseRecord?.value).toEqual(purchase);
    expect(queueHealth?.features?.queuedMessages).toBe(6);
    expect(storeHealth?.features?.storedRecords).toBe(4);
    expect(observabilityHealth?.features?.bufferedMetrics).toBe(6);
    expect(observabilityHealth?.features?.bufferedTraces).toBe(6);
  });

  it("routes PactCompute job lifecycle through managed queue, store, and observability adapters", async () => {
    const queue = new RemoteHttpManagedQueueAdapterSkeleton({
      domain: "compute",
      profile: {
        backendId: "managed-compute-queue",
        providerId: "managed-compute",
        endpoint: "https://managed.example.com/compute/queue",
        credentialSchema: {
          type: "bearer",
          fields: [{ key: "token", required: true, secret: true }],
        },
        configuredCredentialFields: ["token"],
      },
    });
    const store = new RemoteHttpManagedStoreAdapterSkeleton<unknown>({
      domain: "compute",
      profile: {
        backendId: "managed-compute-store",
        providerId: "managed-compute",
        endpoint: "https://managed.example.com/compute/store",
        credentialSchema: {
          type: "api_key",
          fields: [{ key: "apiKey", required: true, secret: true }],
        },
        configuredCredentialFields: ["apiKey"],
      },
    });
    const observability = new RemoteHttpManagedObservabilityAdapterSkeleton({
      domain: "compute",
      profile: {
        backendId: "managed-compute-observability",
        providerId: "managed-compute",
        endpoint: "https://managed.example.com/compute/observability",
        credentialSchema: {
          type: "bearer",
          fields: [{ key: "token", required: true, secret: true }],
        },
        configuredCredentialFields: ["token"],
      },
    });
    const container = createContainer(undefined, {
      managedBackends: {
        compute: {
          queue,
          store,
          observability,
        },
      },
    });
    await container.pactCompute.registerProvider({
      id: "provider-1",
      name: "Managed GPU",
      capabilities: {
        cpuCores: 8,
        memoryMB: 16_384,
        gpuCount: 1,
        gpuModel: "A10",
      },
      pricePerCpuSecondCents: 1,
      pricePerGpuSecondCents: 2,
      pricePerMemoryMBHourCents: 1,
      status: "available",
      registeredAt: Date.now(),
    });

    const job = await container.pactCompute.enqueueComputeJob({
      image: "busybox",
      command: "echo managed",
    });
    const result = await container.pactCompute.dispatchJob(job.id, "provider-1");
    const jobRecord = await store.get(`job:${job.id}`);
    const checkpointPage = await store.list({ prefix: `checkpoint:${job.id}:` });
    const backendHealth = await container.pactCompute.getManagedBackendHealth();
    const queueHealth = backendHealth.backends.find((entry) => entry.capability === "queue");
    const storeHealth = backendHealth.backends.find((entry) => entry.capability === "store");
    const observabilityHealth = backendHealth.backends.find((entry) => entry.capability === "observability");

    expect(result.status).toBe("completed");
    expect(queue.getDepth().available).toBe(1);
    expect(jobRecord?.value).toMatchObject({
      result: {
        jobId: job.id,
        status: "completed",
      },
    });
    expect(checkpointPage?.items.length).toBeGreaterThanOrEqual(2);
    expect(queueHealth?.features?.queuedMessages).toBe(1);
    expect(storeHealth?.features?.storedRecords).toBeGreaterThanOrEqual(3);
    expect(observabilityHealth?.features?.bufferedMetrics).toBe(2);
    expect(observabilityHealth?.features?.bufferedTraces).toBe(2);
  });

  it("routes PactDev lifecycle events through managed queue, store, and observability adapters", async () => {
    const queue = new RemoteHttpManagedQueueAdapterSkeleton({
      domain: "dev",
      profile: {
        backendId: "managed-dev-queue",
        providerId: "managed-dev",
        endpoint: "https://managed.example.com/dev/queue",
        credentialSchema: {
          type: "bearer",
          fields: [{ key: "token", required: true, secret: true }],
        },
        configuredCredentialFields: ["token"],
      },
    });
    const store = new RemoteHttpManagedStoreAdapterSkeleton<unknown>({
      domain: "dev",
      profile: {
        backendId: "managed-dev-store",
        providerId: "managed-dev",
        endpoint: "https://managed.example.com/dev/store",
        credentialSchema: {
          type: "api_key",
          fields: [{ key: "apiKey", required: true, secret: true }],
        },
        configuredCredentialFields: ["apiKey"],
      },
    });
    const observability = new RemoteHttpManagedObservabilityAdapterSkeleton({
      domain: "dev",
      profile: {
        backendId: "managed-dev-observability",
        providerId: "managed-dev",
        endpoint: "https://managed.example.com/dev/observability",
        credentialSchema: {
          type: "oauth2",
          fields: [{ key: "accessToken", required: true, secret: true }],
        },
        configuredCredentialFields: ["accessToken"],
      },
    });
    const container = createContainer(undefined, {
      managedBackends: {
        dev: {
          queue,
          store,
          observability,
        },
      },
    });

    const integration = await container.pactDev.register({
      ownerId: "owner-1",
      name: "Managed SDK",
      webhookUrl: "https://managed.example.com/hooks/sdk",
      version: "1.0.0",
      supportedCoreVersions: ["^0.2.0"],
    });
    await container.pactDev.activate(integration.id);
    const template = await container.pactDev.registerTemplate({
      name: "Bun SDK",
      language: "typescript",
      repoUrl: "https://example.com/sdk",
      description: "Managed SDK template",
    });
    await container.pactDev.registerPolicy({
      id: "policy-1",
      name: "Managed Policy",
      version: "1.0.0",
      rules: [],
      ownerId: "owner-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const integrationRecord = await store.get(`integration:${integration.id}`);
    const templateRecord = await store.get(`template:${template.id}`);
    const policyRecord = await store.get("policy:policy-1");
    const backendHealth = await container.pactDev.getManagedBackendHealth();
    const queueHealth = backendHealth.backends.find((entry) => entry.capability === "queue");
    const storeHealth = backendHealth.backends.find((entry) => entry.capability === "store");
    const observabilityHealth = backendHealth.backends.find((entry) => entry.capability === "observability");

    expect(queue.getDepth().available).toBe(4);
    expect(integrationRecord?.value).toMatchObject({
      id: integration.id,
      status: "active",
    });
    expect(templateRecord?.value).toMatchObject({
      id: template.id,
      language: "typescript",
    });
    expect(policyRecord?.value).toMatchObject({
      id: "policy-1",
      version: "1.0.0",
    });
    expect(queueHealth?.features?.queuedMessages).toBe(4);
    expect(storeHealth?.features?.storedRecords).toBe(3);
    expect(observabilityHealth?.features?.bufferedMetrics).toBe(4);
    expect(observabilityHealth?.features?.bufferedTraces).toBe(4);
  });

  it("accepts aliased managed backend credential fields for remote health contracts", async () => {
    const computeQueue = new RemoteHttpManagedQueueAdapterSkeleton({
      domain: "compute",
      profile: {
        backendId: "managed-compute-queue",
        providerId: "managed-compute",
        endpoint: "https://managed.example.com/compute/queue",
        credentialSchema: {
          type: "bearer",
          fields: [{ key: "access_token", required: true, secret: true }],
        },
        configuredCredentialFields: ["accessToken"],
      },
    });
    const devObservability = new RemoteHttpManagedObservabilityAdapterSkeleton({
      domain: "dev",
      profile: {
        backendId: "managed-dev-observability",
        providerId: "managed-dev",
        endpoint: "https://managed.example.com/dev/observability",
        credentialSchema: {
          type: "service_account",
          fields: [
            { key: "token", required: true, secret: true },
            { key: "email", required: false },
            { key: "project_id", required: false },
          ],
        },
        configuredCredentialFields: ["client_email", "projectId", "access_token"],
      },
    });
    const container = createContainer(undefined, {
      managedBackends: {
        compute: {
          queue: computeQueue,
        },
        dev: {
          observability: devObservability,
        },
      },
    });
    const app = createApp(undefined, { container });

    const computeResponse = await app.request("/compute/backends/health");
    const computeBody = (await computeResponse.json()) as {
      status: string;
      backends: Array<{
        capability: string;
        state: string;
        profile?: { configuredCredentialFields?: string[] };
      }>;
    };
    const devResponse = await app.request("/dev/backends/health");
    const devBody = (await devResponse.json()) as {
      status: string;
      backends: Array<{
        capability: string;
        state: string;
        profile?: { configuredCredentialFields?: string[] };
      }>;
    };

    expect(computeResponse.status).toBe(200);
    expect(devResponse.status).toBe(200);
    expect(computeBody.status).toBe("healthy");
    expect(devBody.status).toBe("healthy");
    expect(computeBody.backends.find((entry) => entry.capability === "queue")).toMatchObject({
      state: "healthy",
      profile: {
        configuredCredentialFields: ["token"],
      },
    });
    expect(devBody.backends.find((entry) => entry.capability === "observability")).toMatchObject({
      state: "healthy",
      profile: {
        configuredCredentialFields: ["accessToken", "clientEmail", "projectId"],
      },
    });
  });

  it("rejects duplicate aliased credential schema fields in direct managed backend adapters", () => {
    expect(() => new RemoteHttpManagedObservabilityAdapterSkeleton({
      domain: "dev",
      profile: {
        backendId: "managed-dev-observability",
        providerId: "managed-dev",
        endpoint: "https://managed.example.com/dev/observability",
        credentialSchema: {
          type: "service_account",
          fields: [
            { key: "token", required: true, secret: true },
            { key: "access_token", required: true, secret: true },
          ],
        },
        configuredCredentialFields: ["token"],
      },
    })).toThrow("managedBackend.credentialSchema.fields contains duplicate keys");
  });

  it("rejects duplicate aliased credential schema fields in env-backed managed backend profiles", () => {
    expect(() => createContainer(undefined, {
      env: {
        PACT_DEV_OBSERVABILITY_BACKEND_PROFILE_JSON: JSON.stringify({
          backendId: "managed-dev-observability",
          providerId: "managed-dev",
          endpoint: "https://managed.example.com/dev/observability",
          credentialType: "service_account",
          credentialSchema: {
            fields: [
              { key: "token", required: true, secret: true },
              { key: "access_token", required: true, secret: true },
            ],
          },
          configuredCredentialFields: ["token"],
        }),
      },
    })).toThrow("managedBackend.credentialSchema.fields contains duplicate keys");
  });

  it("reports degraded remote managed backend health when credentials are incomplete", async () => {
    const dataStore = new RemoteHttpManagedStoreAdapterSkeleton<string>({
      domain: "data",
      profile: {
        backendId: "managed-data-store",
        providerId: "managed-data",
        displayName: "Managed Data Store",
        endpoint: "https://managed.example.com/data/store",
        timeoutMs: 2_000,
        credentialSchema: {
          type: "api_key",
          fields: [{ key: "apiKey", required: true, secret: true }],
        },
        configuredCredentialFields: [],
      },
    });
    const devObservability = new RemoteHttpManagedObservabilityAdapterSkeleton({
      domain: "dev",
      profile: {
        backendId: "managed-dev-observability",
        providerId: "managed-dev",
        displayName: "Managed Dev Observability",
        endpoint: "https://managed.example.com/dev/observability",
        timeoutMs: 2_000,
        credentialSchema: {
          type: "bearer",
          fields: [{ key: "token", required: true, secret: true }],
        },
        configuredCredentialFields: [],
      },
    });
    const container = createContainer(undefined, {
      managedBackends: {
        data: {
          store: dataStore,
        },
        dev: {
          observability: devObservability,
        },
      },
    });
    const app = createApp(undefined, { container });

    const dataResponse = await app.request("/data/backends/health");
    const dataBody = (await dataResponse.json()) as {
      status: string;
      backends: Array<{
        capability: string;
        state: string;
        lastError?: { code?: string };
      }>;
    };
    const devResponse = await app.request("/dev/backends/health");
    const devBody = (await devResponse.json()) as {
      status: string;
      backends: Array<{
        capability: string;
        state: string;
        lastError?: { code?: string };
      }>;
    };

    expect(dataResponse.status).toBe(200);
    expect(devResponse.status).toBe(200);
    expect(dataBody.status).toBe("degraded");
    expect(devBody.status).toBe("degraded");
    expect(dataBody.backends.find((entry) => entry.capability === "store")?.state).toBe("degraded");
    expect(dataBody.backends.find((entry) => entry.capability === "store")?.lastError?.code).toBe(
      "managed_backend_credentials_incomplete",
    );
    expect(devBody.backends.find((entry) => entry.capability === "observability")?.state).toBe("degraded");
    expect(devBody.backends.find((entry) => entry.capability === "observability")?.lastError?.code).toBe(
      "managed_backend_credentials_incomplete",
    );
  });

  it("reports degraded remote managed backend health when endpoint configuration is missing", async () => {
    const dataQueue = new RemoteHttpManagedQueueAdapterSkeleton({
      domain: "data",
      profile: {
        backendId: "managed-data-queue",
        providerId: "managed-data",
        credentialSchema: {
          type: "bearer",
          fields: [{ key: "token", required: true, secret: true }],
        },
        configuredCredentialFields: ["token"],
      },
    });
    const computeStore = new RemoteHttpManagedStoreAdapterSkeleton<string>({
      domain: "compute",
      profile: {
        backendId: "managed-compute-store",
        providerId: "managed-compute",
        credentialSchema: {
          type: "api_key",
          fields: [{ key: "apiKey", required: true, secret: true }],
        },
        configuredCredentialFields: ["apiKey"],
      },
    });
    const container = createContainer(undefined, {
      managedBackends: {
        data: {
          queue: dataQueue,
        },
        compute: {
          store: computeStore,
        },
      },
    });
    const app = createApp(undefined, { container });

    const dataResponse = await app.request("/data/backends/health");
    const dataBody = (await dataResponse.json()) as {
      status: string;
      backends: Array<{
        capability: string;
        state: string;
        lastError?: { code?: string; operation?: string };
      }>;
    };
    const computeResponse = await app.request("/compute/backends/health");
    const computeBody = (await computeResponse.json()) as {
      status: string;
      backends: Array<{
        capability: string;
        state: string;
        lastError?: { code?: string; operation?: string };
      }>;
    };

    expect(dataResponse.status).toBe(200);
    expect(computeResponse.status).toBe(200);
    expect(dataBody.status).toBe("degraded");
    expect(computeBody.status).toBe("degraded");
    expect(dataBody.backends.find((entry) => entry.capability === "queue")).toMatchObject({
      state: "degraded",
      lastError: {
        code: "managed_backend_endpoint_missing",
        operation: "configure_remote_queue",
      },
    });
    expect(computeBody.backends.find((entry) => entry.capability === "store")).toMatchObject({
      state: "degraded",
      lastError: {
        code: "managed_backend_endpoint_missing",
        operation: "configure_remote_store",
      },
    });
  });

  it("loads env-configured remote managed backends for data, compute, and dev", async () => {
    const container = createContainer(undefined, {
      env: {
        PACT_DATA_STORE_BACKEND_ENDPOINT: "https://managed.example.com/data/store",
        PACT_DATA_STORE_BACKEND_PROVIDER_ID: "managed-data",
        PACT_DATA_STORE_BACKEND_CREDENTIAL_TYPE: "api_key",
        PACT_DATA_STORE_BACKEND_CREDENTIAL_API_KEY: "data-key",
        PACT_COMPUTE_QUEUE_BACKEND_PROFILE_JSON: JSON.stringify({
          backendId: "managed-compute-queue",
          providerId: "managed-compute",
          endpoint: "https://managed.example.com/compute/queue",
          credentialType: "bearer",
        }),
        PACT_COMPUTE_QUEUE_BACKEND_CREDENTIAL_TOKEN: "compute-token",
        PACT_DEV_OBSERVABILITY_BACKEND_ENDPOINT: "https://managed.example.com/dev/observability",
        PACT_DEV_OBSERVABILITY_BACKEND_PROVIDER_ID: "managed-dev",
        PACT_DEV_OBSERVABILITY_BACKEND_CREDENTIAL_TYPE: "oauth2",
        PACT_DEV_OBSERVABILITY_BACKEND_CREDENTIAL_ACCESS_TOKEN: "dev-token",
      },
    });
    const app = createApp(undefined, { container });

    const dataResponse = await app.request("/data/backends/health");
    const dataBody = (await dataResponse.json()) as {
      backends: Array<{
        capability: string;
        mode: string;
        state: string;
        profile?: {
          providerId?: string;
          credentialType?: string;
          requiredCredentialFields?: string[];
          configuredCredentialFields?: string[];
        };
      }>;
    };
    const computeResponse = await app.request("/compute/backends/health");
    const computeBody = (await computeResponse.json()) as {
      backends: Array<{
        capability: string;
        mode: string;
        state: string;
        profile?: {
          providerId?: string;
          credentialType?: string;
          requiredCredentialFields?: string[];
          configuredCredentialFields?: string[];
        };
      }>;
    };
    const devResponse = await app.request("/dev/backends/health");
    const devBody = (await devResponse.json()) as {
      backends: Array<{
        capability: string;
        mode: string;
        state: string;
        profile?: {
          providerId?: string;
          credentialType?: string;
          requiredCredentialFields?: string[];
          configuredCredentialFields?: string[];
        };
      }>;
    };

    expect(dataResponse.status).toBe(200);
    expect(computeResponse.status).toBe(200);
    expect(devResponse.status).toBe(200);
    expect(dataBody.backends.find((entry) => entry.capability === "store")).toMatchObject({
      mode: "remote",
      state: "healthy",
      profile: {
        providerId: "managed-data",
        credentialType: "api_key",
        configuredCredentialFields: ["apiKey"],
      },
    });
    expect(computeBody.backends.find((entry) => entry.capability === "queue")).toMatchObject({
      mode: "remote",
      state: "healthy",
      profile: {
        providerId: "managed-compute",
        credentialType: "bearer",
        requiredCredentialFields: ["token"],
        configuredCredentialFields: ["token"],
      },
    });
    expect(devBody.backends.find((entry) => entry.capability === "observability")).toMatchObject({
      mode: "remote",
      state: "healthy",
      profile: {
        providerId: "managed-dev",
        credentialType: "oauth2",
        requiredCredentialFields: ["accessToken"],
        configuredCredentialFields: ["accessToken"],
      },
    });
  });

  it("canonicalizes aliased env-backed managed backend credential fields", async () => {
    const container = createContainer(undefined, {
      env: {
        PACT_COMPUTE_QUEUE_BACKEND_ENDPOINT: "https://managed.example.com/compute/queue",
        PACT_COMPUTE_QUEUE_BACKEND_PROVIDER_ID: "managed-compute",
        PACT_COMPUTE_QUEUE_BACKEND_CREDENTIAL_TYPE: "bearer",
        PACT_COMPUTE_QUEUE_BACKEND_CREDENTIAL_ACCESS_TOKEN: "compute-token",
        PACT_DEV_OBSERVABILITY_BACKEND_PROFILE_JSON: JSON.stringify({
          backendId: "managed-dev-observability",
          providerId: "managed-dev",
          endpoint: "https://managed.example.com/dev/observability",
          credentialType: "service_account",
          credentialSchema: {
            fields: [
              { key: "token", required: true, secret: true },
              { key: "client_email", required: false },
              { key: "project_id", required: false },
            ],
          },
          configuredCredentialFields: ["email"],
        }),
        PACT_DEV_OBSERVABILITY_BACKEND_CREDENTIAL_TOKEN: "dev-token",
        PACT_DEV_OBSERVABILITY_BACKEND_CREDENTIAL_EMAIL: "ops@managed.example.com",
        PACT_DEV_OBSERVABILITY_BACKEND_CREDENTIAL_PROJECT_ID: "managed-dev-project",
      },
    });
    const app = createApp(undefined, { container });

    const computeResponse = await app.request("/compute/backends/health");
    const computeBody = (await computeResponse.json()) as {
      status: string;
      backends: Array<{
        capability: string;
        state: string;
        profile?: { requiredCredentialFields?: string[]; configuredCredentialFields?: string[] };
      }>;
    };
    const devResponse = await app.request("/dev/backends/health");
    const devBody = (await devResponse.json()) as {
      status: string;
      backends: Array<{
        capability: string;
        state: string;
        profile?: { requiredCredentialFields?: string[]; configuredCredentialFields?: string[] };
      }>;
    };

    expect(computeResponse.status).toBe(200);
    expect(devResponse.status).toBe(200);
    expect(computeBody.status).toBe("healthy");
    expect(devBody.status).toBe("healthy");
    expect(computeBody.backends.find((entry) => entry.capability === "queue")).toMatchObject({
      state: "healthy",
      profile: {
        requiredCredentialFields: ["token"],
        configuredCredentialFields: ["token"],
      },
    });
    expect(devBody.backends.find((entry) => entry.capability === "observability")).toMatchObject({
      state: "healthy",
      profile: {
        requiredCredentialFields: ["accessToken"],
        configuredCredentialFields: ["accessToken", "clientEmail", "projectId"],
      },
    });
  });

  it("mirrors PactData, PactCompute, and PactDev operations into managed backend contracts", async () => {
    const container = createContainer(undefined, {
      managedBackends: {
        data: {
          queue: new RemoteHttpManagedQueueAdapterSkeleton({ domain: "data", profile: buildBearerProfile("data", "queue") }),
          store: new RemoteHttpManagedStoreAdapterSkeleton({ domain: "data", profile: buildBearerProfile("data", "store") }),
          observability: new RemoteHttpManagedObservabilityAdapterSkeleton({
            domain: "data",
            profile: buildBearerProfile("data", "observability"),
          }),
        },
        compute: {
          queue: new RemoteHttpManagedQueueAdapterSkeleton({ domain: "compute", profile: buildBearerProfile("compute", "queue") }),
          store: new RemoteHttpManagedStoreAdapterSkeleton({ domain: "compute", profile: buildBearerProfile("compute", "store") }),
          observability: new RemoteHttpManagedObservabilityAdapterSkeleton({
            domain: "compute",
            profile: buildBearerProfile("compute", "observability"),
          }),
        },
        dev: {
          queue: new RemoteHttpManagedQueueAdapterSkeleton({ domain: "dev", profile: buildBearerProfile("dev", "queue") }),
          store: new RemoteHttpManagedStoreAdapterSkeleton({ domain: "dev", profile: buildBearerProfile("dev", "store") }),
          observability: new RemoteHttpManagedObservabilityAdapterSkeleton({
            domain: "dev",
            profile: buildBearerProfile("dev", "observability"),
          }),
        },
      },
    });

    const asset = await container.pactData.publish({
      ownerId: "owner-1",
      title: "Training corpus",
      uri: "s3://datasets/training-corpus",
      derivedFrom: ["raw-1"],
    });
    await container.pactData.registerIntegrityProof(asset.id, "sha256:asset-proof");

    const provider = {
      id: "provider-managed",
      name: "managed-provider",
      capabilities: { cpuCores: 4, memoryMB: 8192, gpuCount: 0 },
      pricePerCpuSecondCents: 1,
      pricePerGpuSecondCents: 4,
      pricePerMemoryMBHourCents: 1,
      status: "available" as const,
      registeredAt: Date.now(),
    };
    await container.pactCompute.registerProvider(provider);
    const job = await container.pactCompute.enqueueComputeJob({
      image: "alpine:latest",
      command: "echo managed",
    });
    await container.pactCompute.dispatchJob(job.id, provider.id);

    const integration = await container.pactDev.register({
      ownerId: "developer-1",
      name: "managed-hook",
      webhookUrl: "https://example.com/hooks/managed",
      supportedCoreVersions: ["^0.2.0"],
    });
    await container.pactDev.activate(integration.id);
    await container.pactDev.registerPolicy({
      id: "pkg-managed",
      name: "managed-policy",
      version: "1.0.0",
      rules: [],
      ownerId: "developer-1",
      createdAt: 1_710_000_000_000,
      updatedAt: 1_710_000_000_000,
    });
    await container.pactDev.registerTemplate({
      name: "managed-template",
      language: "TypeScript",
      repoUrl: "https://example.com/templates/managed",
      description: "Managed template",
    });

    const app = createApp(undefined, { container });
    const dataResponse = await app.request("/data/backends/health");
    const computeResponse = await app.request("/compute/backends/health");
    const devResponse = await app.request("/dev/backends/health");
    const dataBody = (await dataResponse.json()) as {
      backends: Array<{ capability: string; features?: Record<string, boolean | number | string> }>;
    };
    const computeBody = (await computeResponse.json()) as {
      backends: Array<{ capability: string; features?: Record<string, boolean | number | string> }>;
    };
    const devBody = (await devResponse.json()) as {
      backends: Array<{ capability: string; features?: Record<string, boolean | number | string> }>;
    };

    const dataQueue = dataBody.backends.find((entry) => entry.capability === "queue");
    const dataStore = dataBody.backends.find((entry) => entry.capability === "store");
    const dataObservability = dataBody.backends.find((entry) => entry.capability === "observability");
    const computeQueue = computeBody.backends.find((entry) => entry.capability === "queue");
    const computeStore = computeBody.backends.find((entry) => entry.capability === "store");
    const computeObservability = computeBody.backends.find((entry) => entry.capability === "observability");
    const devQueue = devBody.backends.find((entry) => entry.capability === "queue");
    const devStore = devBody.backends.find((entry) => entry.capability === "store");
    const devObservability = devBody.backends.find((entry) => entry.capability === "observability");

    expect(dataQueue?.features?.queuedMessages).toBe(1);
    expect(Number(dataStore?.features?.storedRecords)).toBeGreaterThanOrEqual(2);
    expect(Number(dataObservability?.features?.bufferedMetrics)).toBeGreaterThanOrEqual(2);
    expect(Number(dataObservability?.features?.bufferedTraces)).toBeGreaterThanOrEqual(2);

    expect(computeQueue?.features?.queuedMessages).toBe(1);
    expect(Number(computeStore?.features?.storedRecords)).toBeGreaterThanOrEqual(3);
    expect(Number(computeObservability?.features?.bufferedMetrics)).toBeGreaterThanOrEqual(2);
    expect(Number(computeObservability?.features?.bufferedTraces)).toBeGreaterThanOrEqual(1);

    expect(Number(devQueue?.features?.queuedMessages)).toBeGreaterThanOrEqual(4);
    expect(Number(devStore?.features?.storedRecords)).toBeGreaterThanOrEqual(3);
    expect(Number(devObservability?.features?.bufferedMetrics)).toBeGreaterThanOrEqual(4);
    expect(Number(devObservability?.features?.bufferedTraces)).toBeGreaterThanOrEqual(2);
  });
});

function buildBearerProfile(domain: string, capability: string) {
  return {
    backendId: `managed-${domain}-${capability}`,
    providerId: `managed-${domain}`,
    displayName: `Managed ${domain} ${capability}`,
    endpoint: `https://managed.example.com/${domain}/${capability}`,
    timeoutMs: 2_000,
    credentialSchema: {
      type: "bearer" as const,
      fields: [{ key: "token", required: true, secret: true }],
    },
    configuredCredentialFields: ["token"],
  };
}
