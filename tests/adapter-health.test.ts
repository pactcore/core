import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createContainer } from "../src/application/container";
import { createApp } from "../src/api/app";

describe("adapter health routes", () => {
  test("reports durable data adapter health for file-backed metadata store", async () => {
    const directory = await mkdtemp(join(process.cwd(), "tmp-data-adapter-"));
    const filePath = join(directory, "data-assets.json");

    try {
      const first = createContainer(undefined, {
        env: {
          PACT_DATA_ASSET_STORE_FILE: filePath,
        },
      });

      const asset = await first.pactData.publish({
        ownerId: "seller-1",
        title: "Durable Asset",
        uri: "ipfs://asset-1",
      });

      const second = createContainer(undefined, {
        env: {
          PACT_DATA_ASSET_STORE_FILE: filePath,
        },
      });
      const restored = await second.pactData.getById(asset.id);

      const app = createApp(undefined, {
        container: second,
      });
      const response = await app.request("/data/adapters/health");
      const body = (await response.json()) as {
        status: string;
        adapters: Array<{ name: string; durable?: boolean; durability?: string; state: string }>;
      };
      const store = body.adapters.find((entry) => entry.name === "asset-metadata-store");

      expect(restored?.title).toBe("Durable Asset");
      expect(response.status).toBe(200);
      expect(body.status).toBe("healthy");
      expect(store?.durable).toBe(true);
      expect(store?.durability).toBe("filesystem");
      expect(store?.state).toBe("healthy");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("reports compute adapter runtime capabilities", async () => {
    const app = createApp();
    const response = await app.request("/compute/adapters/health");
    const body = (await response.json()) as {
      status: string;
      adapters: Array<{ name: string; features?: Record<string, boolean> }>;
    };
    const execution = body.adapters.find((entry) => entry.name === "compute-execution-adapter");
    const checkpointStore = body.adapters.find((entry) => entry.name === "compute-checkpoint-store");

    expect(response.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(execution?.features?.runtimeAware).toBe(true);
    expect(execution?.features?.cancellation).toBe(true);
    expect(execution?.features?.timeout).toBe(true);
    expect(checkpointStore?.features?.checkpointing).toBe(true);
  });

  test("reports dev integration health with compatibility checks", async () => {
    const app = createApp();

    const compatible = await app.request("/dev/integrations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "dev-1",
        name: "compatible-webhook",
        webhookUrl: "https://example.com/ok",
        version: "1.2.0",
        supportedCoreVersions: ["^0.2.0"],
      }),
    });
    const compatibleBody = (await compatible.json()) as { id: string };

    await app.request(`/dev/integrations/${compatibleBody.id}/activate`, { method: "POST" });

    const incompatible = await app.request("/dev/integrations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "dev-2",
        name: "legacy-webhook",
        webhookUrl: "https://example.com/legacy",
        version: "0.8.0",
        supportedCoreVersions: ["1.0.x"],
      }),
    });
    const incompatibleBody = (await incompatible.json()) as { id: string };
    await app.request(`/dev/integrations/${incompatibleBody.id}/activate`, { method: "POST" });

    const response = await app.request("/dev/integrations/health");
    const body = (await response.json()) as {
      status: string;
      runtimeVersion: string;
      integrations: Array<{ integrationId: string; state: string; compatibility?: { compatible: boolean } }>;
    };
    const compatibleHealth = body.integrations.find((entry) => entry.integrationId === compatibleBody.id);
    const incompatibleHealth = body.integrations.find((entry) => entry.integrationId === incompatibleBody.id);

    expect(response.status).toBe(200);
    expect(body.runtimeVersion).toBe("0.2.0");
    expect(body.status).toBe("unhealthy");
    expect(compatibleHealth?.state).toBe("healthy");
    expect(compatibleHealth?.compatibility?.compatible).toBe(true);
    expect(incompatibleHealth?.state).toBe("unhealthy");
    expect(incompatibleHealth?.compatibility?.compatible).toBe(false);
  });

  test("reports zk bridge adapter health when bridge-local mode is configured", async () => {
    const container = createContainer(undefined, {
      env: {
        PACT_ZK_PROVER_MODE: "bridge-local",
        PACT_ZK_ADAPTER_NAME: "bridge-local-health",
      },
    });

    const app = createApp(undefined, { container });
    const response = await app.request("/zk/adapters/health");
    const body = (await response.json()) as {
      status: string;
      adapters: Array<{ name: string; state: string; durability?: string }>;
    };
    const bridge = body.adapters.find((entry) => entry.name === "zk-prover-bridge");

    expect(response.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(bridge?.state).toBe("healthy");
    expect(bridge?.durability).toBe("memory");
  });

  test("reports healthy remote zk bridge health for env-configured oauth-style credentials", async () => {
    const container = createContainer(undefined, {
      env: {
        PACT_ZK_PROVER_MODE: "bridge-remote",
        PACT_ZK_ADAPTER_NAME: "bridge-remote-health",
        PACT_ZK_REMOTE_ENDPOINT: "https://zk.example.test/prover",
        PACT_ZK_REMOTE_PROVIDER_ID: "appendix-c-provider",
        PACT_ZK_REMOTE_CREDENTIAL_TYPE: "oauth2",
        PACT_ZK_REMOTE_CREDENTIAL_ACCESS_TOKEN: "secret-token",
      },
    });

    const app = createApp(undefined, { container });
    const response = await app.request("/zk/adapters/health");
    const body = (await response.json()) as {
      status: string;
      adapters: Array<{
        name: string;
        state: string;
        durability?: string;
        features?: Record<string, string | boolean | number>;
        lastError?: { code?: string };
      }>;
    };
    const bridge = body.adapters.find((entry) => entry.name === "zk-prover-bridge");

    expect(response.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(bridge?.state).toBe("healthy");
    expect(bridge?.durability).toBe("remote");
    expect(bridge?.features?.providerId).toBe("appendix-c-provider");
    expect(bridge?.features?.configuredCredentialFields).toBe("accessToken");
    expect(bridge?.features?.requiredCredentialFields).toBe("accessToken");
    expect(bridge?.lastError).toBeUndefined();
  });

  test("reports explicit remote zk endpoint configuration failures", async () => {
    const container = createContainer(undefined, {
      env: {
        PACT_ZK_PROVER_MODE: "bridge-remote",
        PACT_ZK_ADAPTER_NAME: "bridge-remote-degraded",
        PACT_ZK_REMOTE_CREDENTIAL_TYPE: "bearer",
        PACT_ZK_REMOTE_CREDENTIAL_TOKEN: "secret-token",
      },
    });

    const app = createApp(undefined, { container });
    const response = await app.request("/zk/adapters/health");
    const body = (await response.json()) as {
      status: string;
      adapters: Array<{ name: string; state: string; lastError?: { code?: string } }>;
    };
    const bridge = body.adapters.find((entry) => entry.name === "zk-prover-bridge");

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(bridge?.state).toBe("degraded");
    expect(bridge?.lastError?.code).toBe("zk_remote_endpoint_missing");
  });
});
