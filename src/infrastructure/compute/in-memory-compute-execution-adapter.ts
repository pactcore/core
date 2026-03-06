import type {
  ComputeDispatchOptions,
  RuntimeAwareComputeExecutionAdapter,
  ScheduledJob,
} from "../../application/contracts";
import type { AdapterHealthReport } from "../../application/adapter-runtime";
import type { ComputeJobResult, ComputeProvider, ComputeUsageRecord } from "../../domain/types";
import { generateId } from "../../application/utils";

export class InMemoryComputeExecutionAdapter implements RuntimeAwareComputeExecutionAdapter {
  async execute(job: ScheduledJob, provider: ComputeProvider): Promise<ComputeJobResult> {
    const cpuSeconds = 10 + Math.floor(Math.random() * 50);
    const memoryMBHours = 0.5 + Math.random() * 2;
    const gpuSeconds = provider.capabilities.gpuCount > 0 ? 5 + Math.floor(Math.random() * 20) : 0;

    const totalCostCents = Math.round(
      cpuSeconds * provider.pricePerCpuSecondCents +
      memoryMBHours * provider.pricePerMemoryMBHourCents +
      gpuSeconds * provider.pricePerGpuSecondCents,
    );

    const now = Date.now();

    const usage: ComputeUsageRecord = {
      id: generateId("usage"),
      jobId: job.id,
      providerId: provider.id,
      cpuSeconds,
      memoryMBHours,
      gpuSeconds,
      totalCostCents,
      recordedAt: now,
    };

    return {
      jobId: job.id,
      providerId: provider.id,
      status: "completed",
      output: `Executed ${(job.payload as { command?: string })?.command ?? "unknown"} on ${provider.name}`,
      usage,
      completedAt: now,
      execution: {
        terminalState: "completed",
        attemptCount: 1,
      },
    };
  }

  async executeWithRuntime(
    job: ScheduledJob,
    provider: ComputeProvider,
    runtime: ComputeDispatchOptions,
  ): Promise<ComputeJobResult> {
    await runtime.onCheckpoint?.({
      jobId: job.id,
      providerId: provider.id,
      attempt: 1,
      state: "running",
      createdAt: Date.now(),
      message: "In-memory execution running",
    });

    return this.execute(job, provider);
  }

  async cancel(): Promise<boolean> {
    return true;
  }

  getHealth(): AdapterHealthReport {
    return {
      name: "compute-execution-adapter",
      state: "healthy",
      checkedAt: Date.now(),
      durable: false,
      durability: "memory",
      features: {
        runtimeAware: true,
        checkpointing: true,
        cancellation: true,
        retries: true,
        timeout: true,
      },
    };
  }
}
