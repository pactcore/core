import { describe, expect, it } from "bun:test";
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
        profile?: { endpoint?: string; credentialType?: string };
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
    const page = await dataStore.list({ prefix: "asset:", limit: 1 });
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
        profile?: { endpoint?: string; credentialType?: string };
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
        profile?: { endpoint?: string; credentialType?: string };
        features?: Record<string, boolean | number | string>;
      }>;
    };

    const dataStoreHealth = dataBody.backends.find((entry) => entry.capability === "store");
    const devObservabilityHealth = devBody.backends.find((entry) => entry.capability === "observability");

    expect(stored?.value).toBe("cid://asset-1");
    expect(stored?.etag).toBe("managed-data-store:asset:1:1710000000000");
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.key).toBe("asset:1");
    expect(page.nextCursor).toBe("asset:1");
    expect(dataResponse.status).toBe(200);
    expect(devResponse.status).toBe(200);
    expect(dataBody.status).toBe("healthy");
    expect(devBody.status).toBe("healthy");
    expect(dataStoreHealth?.mode).toBe("remote");
    expect(dataStoreHealth?.state).toBe("healthy");
    expect(dataStoreHealth?.profile?.endpoint).toBe("https://managed.example.com/data/store");
    expect(dataStoreHealth?.profile?.credentialType).toBe("api_key");
    expect(dataStoreHealth?.features?.skeleton).toBe(true);
    expect(dataStoreHealth?.features?.storedRecords).toBe(2);
    expect(devObservabilityHealth?.mode).toBe("remote");
    expect(devObservabilityHealth?.state).toBe("healthy");
    expect(devObservabilityHealth?.profile?.endpoint).toBe("https://managed.example.com/dev/observability");
    expect(devObservabilityHealth?.profile?.credentialType).toBe("bearer");
    expect(devObservabilityHealth?.features?.skeleton).toBe(true);
    expect(devObservabilityHealth?.features?.bufferedMetrics).toBe(1);
    expect(devObservabilityHealth?.features?.bufferedTraces).toBe(1);
    expect(devObservabilityHealth?.features?.lastFlushedAt).not.toBe("never");
  });
});
