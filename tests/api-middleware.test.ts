import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createApiKeyAuth } from "../src/api/middleware/api-key-auth";
import { createRateLimiter } from "../src/api/middleware/rate-limiter";
import { createUsageTracker, UsageTracker } from "../src/api/middleware/usage-tracker";
import { InMemoryApiKeyStore } from "../src/infrastructure/api/in-memory-api-key-store";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("API middleware", () => {
  it("rate limiter allows requests under the limit", async () => {
    const app = new Hono();
    app.use(
      "*",
      createRateLimiter({
        windowMs: 1_000,
        maxRequests: 2,
        keyExtractor: () => "test-client",
      }),
    );
    app.get("/limited", (c) => c.json({ ok: true }));

    const first = await app.request("/limited");
    const second = await app.request("/limited");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it("rate limiter blocks requests over the limit with 429", async () => {
    const app = new Hono();
    app.use(
      "*",
      createRateLimiter({
        windowMs: 1_000,
        maxRequests: 2,
        keyExtractor: () => "test-client",
      }),
    );
    app.get("/limited", (c) => c.json({ ok: true }));

    await app.request("/limited");
    await app.request("/limited");
    const blocked = await app.request("/limited");

    expect(blocked.status).toBe(429);
  });

  it("rate limiter resets after the configured window", async () => {
    const app = new Hono();
    app.use(
      "*",
      createRateLimiter({
        windowMs: 25,
        maxRequests: 1,
        keyExtractor: () => "test-client",
      }),
    );
    app.get("/limited", (c) => c.json({ ok: true }));

    const first = await app.request("/limited");
    const blocked = await app.request("/limited");
    await wait(40);
    const afterReset = await app.request("/limited");

    expect(first.status).toBe(200);
    expect(blocked.status).toBe(429);
    expect(afterReset.status).toBe(200);
  });

  it("API key auth rejects missing API keys", async () => {
    const store = new InMemoryApiKeyStore();
    const app = new Hono();
    app.use(
      "*",
      createApiKeyAuth({
        validator: async (key) => store.validateKey(key),
      }),
    );
    app.get("/secure", (c) => c.json({ ok: true }));

    const response = await app.request("/secure");
    expect(response.status).toBe(401);
  });

  it("API key auth rejects invalid API keys", async () => {
    const store = new InMemoryApiKeyStore();
    const app = new Hono();
    app.use(
      "*",
      createApiKeyAuth({
        validator: async (key) => store.validateKey(key),
      }),
    );
    app.get("/secure", (c) => c.json({ ok: true }));

    const response = await app.request("/secure", {
      headers: {
        "x-api-key": "invalid-key",
      },
    });

    expect(response.status).toBe(403);
  });

  it("API key auth passes valid API keys", async () => {
    const store = new InMemoryApiKeyStore();
    const registered = store.registerKey("owner-1", ["read"]);
    const app = new Hono();
    app.use(
      "*",
      createApiKeyAuth({
        validator: async (key) => store.validateKey(key),
      }),
    );
    app.get("/secure", (c) => c.json({ ok: true }));

    const response = await app.request("/secure", {
      headers: {
        "x-api-key": registered.key,
      },
    });

    expect(response.status).toBe(200);
  });

  it("API key info is available in context for downstream handlers", async () => {
    const store = new InMemoryApiKeyStore();
    const registered = store.registerKey("owner-1", ["read", "write"]);
    const app = new Hono();
    app.use(
      "*",
      createApiKeyAuth({
        validator: async (key) => store.validateKey(key),
      }),
    );
    app.get("/secure", (c) => {
      const apiKeyInfo = c.get("apiKeyInfo");
      return c.json({
        id: apiKeyInfo?.id,
        ownerId: apiKeyInfo?.ownerId,
      });
    });

    const response = await app.request("/secure", {
      headers: {
        "x-api-key": registered.key,
      },
    });
    const body = (await response.json()) as { id?: string; ownerId?: string };

    expect(response.status).toBe(200);
    expect(body.id).toBe(registered.id);
    expect(body.ownerId).toBe("owner-1");
  });

  it("usage tracker records requests for authenticated API keys", async () => {
    const store = new InMemoryApiKeyStore();
    const registered = store.registerKey("owner-1", ["read"]);
    const tracker = new UsageTracker();
    const app = new Hono();
    app.use("*", createUsageTracker(tracker));
    app.use(
      "*",
      createApiKeyAuth({
        validator: async (key) => store.validateKey(key),
      }),
    );
    app.get("/secure", (c) => c.json({ ok: true }));

    const response = await app.request("/secure", {
      headers: {
        "x-api-key": registered.key,
      },
    });

    const stats = tracker.getStats(registered.id);
    expect(response.status).toBe(200);
    expect(stats.requestCount).toBe(1);
    expect(stats.errorCount).toBe(0);
  });

  it("usage tracker returns per-key usage stats", async () => {
    const store = new InMemoryApiKeyStore();
    const first = store.registerKey("owner-1", ["read"]);
    const second = store.registerKey("owner-2", ["read"]);
    const tracker = new UsageTracker();
    const app = new Hono();
    app.use("*", createUsageTracker(tracker));
    app.use(
      "*",
      createApiKeyAuth({
        validator: async (key) => store.validateKey(key),
      }),
    );
    app.get("/ok", (c) => c.json({ ok: true }));
    app.get("/fail", (c) => c.json({ ok: false }, 500));

    await app.request("/ok", { headers: { "x-api-key": first.key } });
    await app.request("/fail", { headers: { "x-api-key": first.key } });
    await app.request("/ok", { headers: { "x-api-key": second.key } });

    const firstStats = tracker.getStats(first.id);
    const secondStats = tracker.getStats(second.id);

    expect(firstStats.requestCount).toBe(2);
    expect(firstStats.errorCount).toBe(1);
    expect(secondStats.requestCount).toBe(1);
    expect(secondStats.errorCount).toBe(0);
  });

  it("usage tracker returns overall usage stats across API keys", async () => {
    const store = new InMemoryApiKeyStore();
    const first = store.registerKey("owner-1", ["read"]);
    const second = store.registerKey("owner-2", ["read"]);
    const tracker = new UsageTracker();
    const app = new Hono();
    app.use("*", createUsageTracker(tracker));
    app.use(
      "*",
      createApiKeyAuth({
        validator: async (key) => store.validateKey(key),
      }),
    );
    app.get("/ok", (c) => c.json({ ok: true }));
    app.get("/fail", (c) => c.json({ ok: false }, 500));

    await app.request("/ok", { headers: { "x-api-key": first.key } });
    await app.request("/fail", { headers: { "x-api-key": first.key } });
    await app.request("/ok", { headers: { "x-api-key": second.key } });

    const overall = tracker.getOverallStats();

    expect(overall.requestCount).toBe(3);
    expect(overall.errorCount).toBe(1);
    expect(overall.uniqueApiKeys).toBe(2);
  });
});
