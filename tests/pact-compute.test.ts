import { describe, expect, test } from "bun:test";
import { PactCompute } from "../src/application/modules/pact-compute";
import { InMemoryScheduler } from "../src/infrastructure/scheduler/in-memory-scheduler";
import { InMemoryComputeProviderRegistry } from "../src/infrastructure/compute/in-memory-compute-provider-registry";
import { InMemoryResourceMeter } from "../src/infrastructure/compute/in-memory-resource-meter";
import { InMemoryComputeExecutionAdapter } from "../src/infrastructure/compute/in-memory-compute-execution-adapter";
import type { ComputeProvider } from "../src/domain/types";

function makeProvider(overrides: Partial<ComputeProvider> = {}): ComputeProvider {
  return {
    id: `prov_${crypto.randomUUID()}`,
    name: "test-provider",
    capabilities: { cpuCores: 8, memoryMB: 16384, gpuCount: 1, gpuModel: "A100" },
    pricePerCpuSecondCents: 1,
    pricePerGpuSecondCents: 5,
    pricePerMemoryMBHourCents: 2,
    status: "available",
    registeredAt: Date.now(),
    ...overrides,
  };
}

function setup() {
  const scheduler = new InMemoryScheduler();
  const registry = new InMemoryComputeProviderRegistry();
  const meter = new InMemoryResourceMeter();
  const adapter = new InMemoryComputeExecutionAdapter();
  const compute = new PactCompute(scheduler, registry, meter, adapter);
  return { compute, scheduler, registry, meter, adapter };
}

describe("PactCompute", () => {
  test("registers and lists providers", async () => {
    const { compute } = setup();
    const p1 = makeProvider({ name: "alpha" });
    const p2 = makeProvider({ name: "beta" });

    await compute.registerProvider(p1);
    await compute.registerProvider(p2);

    const providers = await compute.listProviders();
    expect(providers).toHaveLength(2);
    expect(providers.map((p) => p.name).sort()).toEqual(["alpha", "beta"]);
  });

  test("finds providers by capability requirements", async () => {
    const { compute } = setup();
    const small = makeProvider({
      name: "small",
      capabilities: { cpuCores: 2, memoryMB: 4096, gpuCount: 0 },
    });
    const big = makeProvider({
      name: "big",
      capabilities: { cpuCores: 32, memoryMB: 65536, gpuCount: 4, gpuModel: "H100" },
    });
    const offline = makeProvider({
      name: "offline",
      capabilities: { cpuCores: 64, memoryMB: 131072, gpuCount: 8 },
      status: "offline",
    });

    await compute.registerProvider(small);
    await compute.registerProvider(big);
    await compute.registerProvider(offline);

    // Need at least 16 CPU, 32GB
    const found = await compute.findProviders(16, 32768);
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("big");

    // Need GPU
    const withGpu = await compute.findProviders(1, 1, 1);
    expect(withGpu).toHaveLength(1);
    expect(withGpu[0].name).toBe("big");

    // Small requirements match small
    const any = await compute.findProviders(1, 1);
    expect(any).toHaveLength(2); // small + big (offline excluded)
  });

  test("enqueues and runs scheduled compute jobs", async () => {
    const { compute } = setup();

    const job = await compute.enqueueComputeJob({
      image: "python:3.12",
      command: "python train.py",
    });

    expect(job.id).toMatch(/^job_/);
    expect(job.topic).toBe("compute.exec");

    const due = await compute.runDue();
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe(job.id);
  });

  test("dispatches job to specific provider and records metering", async () => {
    const { compute } = setup();
    const provider = makeProvider({ name: "dispatch-target" });
    await compute.registerProvider(provider);

    const job = await compute.enqueueComputeJob({
      image: "node:22",
      command: "node index.js",
    });

    const result = await compute.dispatchJob(job.id, provider.id);
    expect(result.status).toBe("completed");
    expect(result.providerId).toBe(provider.id);
    expect(result.usage.jobId).toBe(job.id);
    expect(result.usage.totalCostCents).toBeGreaterThan(0);

    // Metering recorded
    const records = await compute.getUsageRecords(job.id);
    expect(records).toHaveLength(1);
    expect(records[0].providerId).toBe(provider.id);
  });

  test("auto-selects provider when none specified", async () => {
    const { compute } = setup();
    await compute.registerProvider(makeProvider({ name: "auto" }));

    const job = await compute.enqueueComputeJob({
      image: "ubuntu:24.04",
      command: "echo hello",
    });

    const result = await compute.dispatchJob(job.id);
    expect(result.status).toBe("completed");
  });

  test("throws when no providers available", async () => {
    const { compute } = setup();

    expect(compute.dispatchJob("job_fake")).rejects.toThrow("No available compute providers");
  });

  test("throws when specified provider not found", async () => {
    const { compute } = setup();

    expect(compute.dispatchJob("job_fake", "nonexistent")).rejects.toThrow("not found");
  });

  test("returns all usage records when no jobId filter", async () => {
    const { compute } = setup();
    await compute.registerProvider(makeProvider());

    const j1 = await compute.enqueueComputeJob({ image: "a", command: "a" });
    const j2 = await compute.enqueueComputeJob({ image: "b", command: "b" });

    await compute.dispatchJob(j1.id);
    await compute.dispatchJob(j2.id);

    const all = await compute.getUsageRecords();
    expect(all).toHaveLength(2);
  });
});
