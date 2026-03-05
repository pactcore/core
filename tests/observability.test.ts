import { describe, expect, it } from "bun:test";
import { createApp } from "../src/api/app";
import { InMemoryMetricsRegistry, type MetricsSnapshot } from "../src/observability/metrics";
import { InMemoryTracer, type TraceRecord } from "../src/observability/tracing";

describe("Observability metrics primitives", () => {
  it("counter tracks values per label set", () => {
    const registry = new InMemoryMetricsRegistry();
    const counter = registry.counter("jobs_total");

    counter.inc({ route: "/jobs" });
    counter.inc({ route: "/jobs" }, 2);
    counter.inc({ route: "/tasks" });

    expect(counter.get({ route: "/jobs" })).toBe(3);
    expect(counter.get({ route: "/tasks" })).toBe(1);

    const snapshot = registry.snapshot();
    const jobsTotal = snapshot.counters.find((entry) => entry.name === "jobs_total");
    expect(jobsTotal?.total).toBe(4);
    expect(jobsTotal?.values.length).toBe(2);
  });

  it("gauge supports set, increment, and decrement", () => {
    const registry = new InMemoryMetricsRegistry();
    const gauge = registry.gauge("workers_in_flight");

    gauge.inc();
    gauge.inc({}, 2);
    gauge.dec();
    gauge.set({ queue: "priority" }, 5);

    expect(gauge.get()).toBe(2);
    expect(gauge.get({ queue: "priority" })).toBe(5);
  });

  it("histogram stores count, sum, and cumulative bucket counts", () => {
    const registry = new InMemoryMetricsRegistry();
    const histogram = registry.histogram("latency_ms", { buckets: [10, 100] });

    histogram.observe(5, { route: "/health" });
    histogram.observe(70, { route: "/health" });
    histogram.observe(150, { route: "/health" });

    const snapshot = registry.snapshot();
    const latency = snapshot.histograms.find((entry) => entry.name === "latency_ms");
    const series = latency?.values[0];

    expect(series?.count).toBe(3);
    expect(series?.sum).toBe(225);
    expect(series?.buckets).toEqual([
      { le: 10, count: 1 },
      { le: 100, count: 2 },
      { le: "+Inf", count: 3 },
    ]);
  });
});

describe("Observability tracing primitives", () => {
  it("creates root spans with trace/span context ids", () => {
    const tracer = new InMemoryTracer();
    const rootSpan = tracer.startSpan("root", { attributes: { component: "test" } });
    const context = rootSpan.context;

    rootSpan.end();

    const traces = tracer.getTraces(10);
    const trace = traces[0];
    const firstSpan = trace?.spans[0];

    expect(context.traceId.startsWith("trace_")).toBeTrue();
    expect(context.spanId.startsWith("span_")).toBeTrue();
    expect(context.parentSpanId).toBeUndefined();
    expect(trace?.rootSpanId).toBe(context.spanId);
    expect(firstSpan?.traceId).toBe(context.traceId);
    expect(firstSpan?.attributes.component).toBe("test");
  });

  it("links child spans with parent span ids in the same trace", () => {
    const tracer = new InMemoryTracer();
    const rootSpan = tracer.startSpan("request");
    const childSpan = rootSpan.child("db.query");
    const rootContext = rootSpan.context;

    childSpan.end();
    rootSpan.end();

    const trace = tracer.getTraces(1)[0];
    const dbSpan = trace?.spans.find((span) => span.name === "db.query");

    expect(dbSpan?.traceId).toBe(rootContext.traceId);
    expect(dbSpan?.parentSpanId).toBe(rootContext.spanId);
  });
});

describe("Observability API integration", () => {
  it("records request count and latency per route", async () => {
    const app = createApp();

    const healthResponse = await app.request("/health");
    expect(healthResponse.status).toBe(200);

    const metricsResponse = await app.request("/observability/metrics");
    expect(metricsResponse.status).toBe(200);
    const snapshot = (await metricsResponse.json()) as MetricsSnapshot;

    const requestsCounter = snapshot.counters.find((entry) => entry.name === "http_requests_total");
    const healthCounterValue = requestsCounter?.values.find(
      (entry) =>
        entry.labels.method === "GET" && entry.labels.route === "/health" && entry.labels.status === "200",
    );
    expect(healthCounterValue?.value).toBeGreaterThanOrEqual(1);

    const latencyHistogram = snapshot.histograms.find(
      (entry) => entry.name === "http_request_latency_ms",
    );
    const healthLatencyValue = latencyHistogram?.values.find(
      (entry) =>
        entry.labels.method === "GET" && entry.labels.route === "/health" && entry.labels.status === "200",
    );
    expect(healthLatencyValue?.count).toBeGreaterThanOrEqual(1);
  });

  it("records per-route errors by status code", async () => {
    const app = createApp();

    const badRequest = await app.request("/admin/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(badRequest.status).toBe(400);

    const metricsResponse = await app.request("/observability/metrics");
    const snapshot = (await metricsResponse.json()) as MetricsSnapshot;
    const errorsCounter = snapshot.counters.find(
      (entry) => entry.name === "http_request_errors_total",
    );
    const adminErrorSeries = errorsCounter?.values.find(
      (entry) =>
        entry.labels.method === "POST" &&
        entry.labels.route === "/admin/api-keys" &&
        entry.labels.status === "400",
    );

    expect(adminErrorSeries?.value).toBeGreaterThanOrEqual(1);
  });

  it("returns recent traces and respects the limit query", async () => {
    const app = createApp();

    await app.request("/health");
    await app.request("/health");
    await app.request("/health");

    const tracesResponse = await app.request("/observability/traces?limit=2");
    expect(tracesResponse.status).toBe(200);

    const body = (await tracesResponse.json()) as {
      limit: number;
      traces: TraceRecord[];
    };
    expect(body.limit).toBe(2);
    expect(body.traces.length).toBe(2);
    expect(body.traces[0]?.spans[0]?.traceId).toBeDefined();
    expect(body.traces[0]?.spans[0]?.spanId).toBeDefined();
  });

  it("exposes observability health details", async () => {
    const app = createApp();

    await app.request("/health");

    const healthResponse = await app.request("/observability/health");
    expect(healthResponse.status).toBe(200);

    const body = (await healthResponse.json()) as {
      ok: boolean;
      service: string;
      uptimeMs: number;
      metricFamilies: {
        counters: number;
        gauges: number;
        histograms: number;
      };
      traces: {
        stored: number;
      };
    };

    expect(body.ok).toBeTrue();
    expect(body.service).toBe("pact-network-core-bun");
    expect(body.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(body.metricFamilies.counters).toBeGreaterThanOrEqual(2);
    expect(body.metricFamilies.gauges).toBeGreaterThanOrEqual(1);
    expect(body.metricFamilies.histograms).toBeGreaterThanOrEqual(1);
    expect(body.traces.stored).toBeGreaterThanOrEqual(1);
  });
});
