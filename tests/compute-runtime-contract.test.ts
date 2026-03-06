import { describe, expect, test } from "bun:test";
import type {
  ComputeDispatchOptions,
  ComputeExecutionCheckpoint,
  ComputeExecutionCheckpointStore,
  RuntimeAwareComputeExecutionAdapter,
  ScheduledJob,
} from "../src/application/contracts";
import { PactCompute } from "../src/application/modules/pact-compute";
import { generateId } from "../src/application/utils";
import { ComputeAdapterError } from "../src/application/adapter-runtime";
import { InMemoryComputeProviderRegistry } from "../src/infrastructure/compute/in-memory-compute-provider-registry";
import { InMemoryResourceMeter } from "../src/infrastructure/compute/in-memory-resource-meter";
import { InMemoryComputeExecutionCheckpointStore } from "../src/infrastructure/compute/in-memory-compute-execution-checkpoint-store";
import { InMemoryScheduler } from "../src/infrastructure/scheduler/in-memory-scheduler";
import type { ComputeJobResult, ComputeProvider } from "../src/domain/types";

class RetryThenSuccessAdapter implements RuntimeAwareComputeExecutionAdapter {
  attempts = 0;

  async execute(job: ScheduledJob, provider: ComputeProvider): Promise<ComputeJobResult> {
    return this.executeWithRuntime!(job, provider, {});
  }

  async executeWithRuntime(
    job: ScheduledJob,
    provider: ComputeProvider,
    runtime: ComputeDispatchOptions,
  ): Promise<ComputeJobResult> {
    this.attempts += 1;
    await runtime.onCheckpoint?.({
      jobId: job.id,
      providerId: provider.id,
      attempt: this.attempts,
      state: "running",
      createdAt: Date.now(),
      message: `attempt-${this.attempts}`,
    });

    if (this.attempts === 1) {
      throw new ComputeAdapterError("transient outage", {
        operation: "execute",
        code: "transient_outage",
        retryable: true,
      });
    }

    return {
      jobId: job.id,
      providerId: provider.id,
      status: "completed",
      output: "ok",
      usage: createUsage(job.id, provider.id, 17),
      completedAt: Date.now(),
    };
  }

  async cancel(): Promise<boolean> {
    return true;
  }
}

class AbortAwareAdapter implements RuntimeAwareComputeExecutionAdapter {
  async execute(job: ScheduledJob, provider: ComputeProvider): Promise<ComputeJobResult> {
    return this.executeWithRuntime!(job, provider, {});
  }

  async executeWithRuntime(
    job: ScheduledJob,
    provider: ComputeProvider,
    runtime: ComputeDispatchOptions,
  ): Promise<ComputeJobResult> {
    return new Promise<ComputeJobResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve({
          jobId: job.id,
          providerId: provider.id,
          status: "completed",
          output: "late",
          usage: createUsage(job.id, provider.id, 1),
          completedAt: Date.now(),
        });
      }, 50);

      const onAbort = () => {
        clearTimeout(timer);
        reject(new ComputeAdapterError("aborted", {
          operation: "execute",
          code: "execution_cancelled",
          retryable: false,
        }));
      };

      runtime.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  async cancel(): Promise<boolean> {
    return true;
  }
}

function setup(
  adapter: RuntimeAwareComputeExecutionAdapter,
  checkpointStore: ComputeExecutionCheckpointStore = new InMemoryComputeExecutionCheckpointStore(),
) {
  const scheduler = new InMemoryScheduler();
  const registry = new InMemoryComputeProviderRegistry();
  const meter = new InMemoryResourceMeter();
  const compute = new PactCompute(scheduler, registry, meter, adapter, undefined, checkpointStore);
  return { compute, registry, meter, checkpointStore };
}

function makeProvider(): ComputeProvider {
  return {
    id: "provider-runtime",
    name: "runtime-provider",
    capabilities: { cpuCores: 4, memoryMB: 8192, gpuCount: 0 },
    pricePerCpuSecondCents: 1,
    pricePerGpuSecondCents: 3,
    pricePerMemoryMBHourCents: 1,
    status: "available",
    registeredAt: Date.now(),
  };
}

function createUsage(jobId: string, providerId: string, totalCostCents: number) {
  return {
    id: generateId("usage"),
    jobId,
    providerId,
    cpuSeconds: 1,
    memoryMBHours: 1,
    gpuSeconds: 0,
    totalCostCents,
    recordedAt: Date.now(),
  };
}

describe("compute runtime contract", () => {
  test("retries retryable failures and stores checkpoints", async () => {
    const adapter = new RetryThenSuccessAdapter();
    const { compute, registry, meter, checkpointStore } = setup(adapter);
    const provider = makeProvider();
    await registry.registerProvider(provider);

    const checkpoints: ComputeExecutionCheckpoint[] = [];
    const job = await compute.enqueueComputeJob({
      image: "alpine:latest",
      command: "echo retry",
    });

    const result = await compute.dispatchJob(job.id, provider.id, {
      maxRetries: 1,
      onCheckpoint: async (checkpoint) => {
        checkpoints.push(checkpoint);
      },
    });
    const latest = await checkpointStore.getLatest(job.id);
    const usageRecords = await meter.getByJob(job.id);

    expect(adapter.attempts).toBe(2);
    expect(result.status).toBe("completed");
    expect(result.execution?.attemptCount).toBe(2);
    expect(result.execution?.terminalState).toBe("completed");
    expect(checkpoints.some((checkpoint) => checkpoint.state === "retrying")).toBe(true);
    expect(latest?.state).toBe("completed");
    expect(usageRecords).toHaveLength(1);
    expect(usageRecords[0]?.totalCostCents).toBe(17);
  });

  test("marks aborted executions as cancelled without retry", async () => {
    const { compute, registry, checkpointStore } = setup(new AbortAwareAdapter());
    const provider = makeProvider();
    await registry.registerProvider(provider);

    const job = await compute.enqueueComputeJob({
      image: "alpine:latest",
      command: "sleep 5",
    });
    const controller = new AbortController();
    const dispatchPromise = compute.dispatchJob(job.id, provider.id, {
      signal: controller.signal,
      maxRetries: 2,
    });
    controller.abort();

    const result = await dispatchPromise;
    const latest = await checkpointStore.getLatest(job.id);

    expect(result.status).toBe("failed");
    expect(result.execution?.terminalState).toBe("cancelled");
    expect(result.execution?.attemptCount).toBe(1);
    expect(result.execution?.retryableFailure).toBe(false);
    expect(latest?.state).toBe("cancelled");
  });
});
