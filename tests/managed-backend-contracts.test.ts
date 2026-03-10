import { describe, expect, it } from "bun:test";
import { createApp } from "../src/api/app";
import { createContainer } from "../src/application/container";
import { RemoteHttpManagedQueueAdapterSkeleton } from "../src/infrastructure/managed/remote-http-managed-queue-adapter-skeleton";

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
});
