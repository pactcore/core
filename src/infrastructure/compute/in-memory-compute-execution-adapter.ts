import type { ComputeExecutionAdapter, ScheduledJob } from "../../application/contracts";
import type { ComputeJobResult, ComputeProvider, ComputeUsageRecord } from "../../domain/types";
import { generateId } from "../../application/utils";

/**
 * Simulated compute execution adapter for testing.
 * Generates synthetic usage records based on provider pricing.
 */
export class InMemoryComputeExecutionAdapter implements ComputeExecutionAdapter {
  async execute(job: ScheduledJob, provider: ComputeProvider): Promise<ComputeJobResult> {
    // Simulate resource consumption
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
    };
  }
}
