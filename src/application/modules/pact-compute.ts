import type {
  ComputeDispatchOptions,
  ComputeExecutionAdapter,
  ComputeExecutionCheckpoint,
  ComputeExecutionCheckpointStore,
  ComputeProviderRegistry,
  ResourceMeter,
  RuntimeAwareComputeExecutionAdapter,
  ScheduledJob,
  Scheduler,
} from "../contracts";
import {
  aggregateAdapterHealth,
  ComputeAdapterError,
  type AdapterErrorDescriptor,
  type AdapterHealthReport,
  type AdapterHealthSummary,
} from "../adapter-runtime";
import type {
  ComputeJobResult,
  ComputeProvider,
  ComputeProviderCapabilities,
  ComputeUsageRecord,
} from "../../domain/types";
import type { ResourceTier } from "../../domain/compute-pricing";
import { generateId } from "../utils";

export interface ComputeJobInput {
  image: string;
  command: string;
  runAt?: number;
  metadata?: Record<string, string>;
}

export interface ComputePricingQuote {
  tier: ResourceTier;
  estimatedCostCents: number;
}

export interface ComputePricingEngine {
  quoteCost(
    capabilities: ComputeProviderCapabilities,
    estimatedDurationSeconds: number,
  ): ComputePricingQuote | undefined;
  listTiers(): ResourceTier[];
}

export class PactCompute {
  private readonly jobs = new Map<string, ScheduledJob>();

  constructor(
    private readonly scheduler: Scheduler,
    private readonly providerRegistry: ComputeProviderRegistry,
    private readonly resourceMeter: ResourceMeter,
    private readonly executionAdapter: ComputeExecutionAdapter,
    private readonly pricingEngine?: ComputePricingEngine,
    private readonly checkpointStore?: ComputeExecutionCheckpointStore,
  ) {}

  async registerProvider(provider: ComputeProvider): Promise<void> {
    await this.providerRegistry.registerProvider(provider);
  }

  async listProviders(): Promise<ComputeProvider[]> {
    return this.providerRegistry.listProviders();
  }

  async findProviders(
    minCpu: number,
    minMemory: number,
    minGpu?: number,
  ): Promise<ComputeProvider[]> {
    return this.providerRegistry.findProvidersByCapability(minCpu, minMemory, minGpu);
  }

  quoteCost(
    capabilities: ComputeProviderCapabilities,
    durationSeconds: number,
  ): ComputePricingQuote | undefined {
    return this.pricingEngine?.quoteCost(capabilities, durationSeconds);
  }

  listPricingTiers(): ResourceTier[] {
    return this.pricingEngine?.listTiers() ?? [];
  }

  async enqueueComputeJob(input: ComputeJobInput): Promise<ScheduledJob> {
    const job: ScheduledJob = {
      id: generateId("job"),
      topic: "compute.exec",
      payload: {
        image: input.image,
        command: input.command,
        metadata: input.metadata ?? {},
      },
      runAt: input.runAt ?? Date.now(),
    };

    await this.scheduler.schedule(job);
    this.jobs.set(job.id, job);
    return job;
  }

  async runDue(now?: number): Promise<ScheduledJob[]> {
    return this.scheduler.runDue(now);
  }

  async dispatchJob(
    jobId: string,
    providerId?: string,
    options: ComputeDispatchOptions = {},
  ): Promise<ComputeJobResult> {
    const provider = await this.resolveProvider(providerId);
    const job = this.jobs.get(jobId) ?? {
      id: jobId,
      topic: "compute.exec",
      payload: {},
      runAt: Date.now(),
    };
    this.jobs.set(job.id, job);

    await this.emitCheckpoint({
      jobId: job.id,
      providerId: provider.id,
      attempt: 0,
      state: "queued",
      createdAt: Date.now(),
      message: "Job accepted for dispatch",
    }, options);

    const maxAttempts = Math.max(1, (options.maxRetries ?? 0) + 1);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await this.emitCheckpoint({
        jobId: job.id,
        providerId: provider.id,
        attempt,
        state: "running",
        createdAt: Date.now(),
        message: "Compute execution started",
      }, options);

      try {
        const result = await this.executeAttempt(job, provider, options);
        const terminalState = result.status === "completed"
          ? "completed"
          : result.execution?.terminalState ?? "failed";
        const enriched = this.withExecutionMetadata(result, attempt, terminalState);

        if (
          enriched.status === "failed" &&
          enriched.execution?.retryableFailure === true &&
          attempt < maxAttempts
        ) {
          await this.emitCheckpoint({
            jobId: job.id,
            providerId: provider.id,
            attempt,
            state: "retrying",
            createdAt: Date.now(),
            message: enriched.error ?? "Retrying compute execution",
            error: this.descriptorFromFailedResult(enriched),
          }, options);
          await this.delay(options.retryDelayMs ?? 0);
          continue;
        }

        await this.resourceMeter.record(enriched.usage);
        await this.emitCheckpoint({
          jobId: job.id,
          providerId: provider.id,
          attempt,
          state: terminalState,
          createdAt: Date.now(),
          message: enriched.status === "completed" ? "Compute execution completed" : enriched.error,
          error: enriched.status === "failed" ? this.descriptorFromFailedResult(enriched) : undefined,
        }, options);
        return enriched;
      } catch (error) {
        const adapterError = this.normalizeExecutionError(error);
        const terminalState = adapterError.code === "execution_cancelled"
          ? "cancelled"
          : adapterError.code === "execution_timeout"
            ? "timed_out"
            : "failed";

        await this.emitCheckpoint({
          jobId: job.id,
          providerId: provider.id,
          attempt,
          state: terminalState,
          createdAt: Date.now(),
          message: adapterError.message,
          error: adapterError.toDescriptor(),
        }, options);

        if (adapterError.retryable && attempt < maxAttempts) {
          await this.emitCheckpoint({
            jobId: job.id,
            providerId: provider.id,
            attempt,
            state: "retrying",
            createdAt: Date.now(),
            message: adapterError.message,
            error: adapterError.toDescriptor(),
          }, options);
          await this.delay(options.retryDelayMs ?? 0);
          continue;
        }

        const failed = this.createFailedResult(job.id, provider, attempt, terminalState, adapterError);
        await this.resourceMeter.record(failed.usage);
        return failed;
      }
    }

    throw new ComputeAdapterError("Compute dispatch exhausted retries", {
      operation: "dispatch",
      code: "retry_exhausted",
      retryable: false,
    });
  }

  async getUsageRecords(jobId?: string): Promise<ComputeUsageRecord[]> {
    if (jobId) {
      return this.resourceMeter.getByJob(jobId);
    }
    return this.resourceMeter.listAll();
  }

  async cancelJob(jobId: string, reason = "cancelled by caller"): Promise<boolean> {
    const runtimeAdapter = this.executionAdapter as RuntimeAwareComputeExecutionAdapter;
    if (!runtimeAdapter.cancel) {
      return false;
    }

    const checkpoint = await this.checkpointStore?.getLatest(jobId);
    const cancelled = await runtimeAdapter.cancel(jobId, reason);
    if (cancelled && checkpoint) {
      await this.emitCheckpoint({
        jobId,
        providerId: checkpoint.providerId,
        attempt: checkpoint.attempt,
        state: "cancelled",
        createdAt: Date.now(),
        message: reason,
      });
    }
    return cancelled;
  }

  async getExecutionCheckpoints(jobId: string): Promise<ComputeExecutionCheckpoint[]> {
    if (!this.checkpointStore) {
      return [];
    }
    return this.checkpointStore.listByJob(jobId);
  }

  async getAdapterHealth(): Promise<AdapterHealthSummary> {
    const runtimeAdapter = this.executionAdapter as RuntimeAwareComputeExecutionAdapter;
    const reports: AdapterHealthReport[] = [
      {
        name: "compute-provider-registry",
        state: "healthy",
        checkedAt: Date.now(),
        durable: false,
        durability: "memory",
        features: {
          providerDiscovery: true,
          registeredProviders: (await this.providerRegistry.listProviders()).length,
        },
      },
      {
        name: "compute-resource-meter",
        state: "healthy",
        checkedAt: Date.now(),
        durable: false,
        durability: "memory",
        features: {
          metering: true,
          usageRecords: (await this.resourceMeter.listAll()).length,
        },
      },
      this.checkpointStore?.getHealth
        ? await this.checkpointStore.getHealth()
        : {
            name: "compute-checkpoint-store",
            state: this.checkpointStore ? "healthy" : "degraded",
            checkedAt: Date.now(),
            durable: false,
            durability: "memory",
            features: {
              checkpointing: Boolean(this.checkpointStore),
            },
          },
      runtimeAdapter.getHealth
        ? await runtimeAdapter.getHealth()
        : {
            name: "compute-execution-adapter",
            state: "healthy",
            checkedAt: Date.now(),
            durable: false,
            durability: "memory",
            features: {
              runtimeAware: Boolean(runtimeAdapter.executeWithRuntime),
              cancellation: Boolean(runtimeAdapter.cancel),
              retries: true,
              timeout: true,
            },
          },
    ];

    return aggregateAdapterHealth(reports);
  }

  private async resolveProvider(providerId?: string): Promise<ComputeProvider> {
    if (providerId) {
      const provider = await this.providerRegistry.getProvider(providerId);
      if (!provider) {
        throw new Error(`Provider ${providerId} not found`);
      }
      return provider;
    }

    const available = await this.providerRegistry.findProvidersByCapability(1, 1);
    if (available.length === 0) {
      throw new Error("No available compute providers");
    }
    return available[0]!;
  }

  private async executeAttempt(
    job: ScheduledJob,
    provider: ComputeProvider,
    options: ComputeDispatchOptions,
  ): Promise<ComputeJobResult> {
    const runtimeAdapter = this.executionAdapter as RuntimeAwareComputeExecutionAdapter;
    const signal = options.signal;
    if (signal?.aborted) {
      throw new ComputeAdapterError("Compute execution cancelled", {
        operation: "execute",
        code: "execution_cancelled",
        retryable: false,
      });
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let removeAbortListener: (() => void) | undefined;

    const executionPromise = runtimeAdapter.executeWithRuntime
      ? runtimeAdapter.executeWithRuntime(job, provider, options)
      : this.executionAdapter.execute(job, provider);
    const contenders: Array<Promise<ComputeJobResult>> = [executionPromise];

    if (options.timeoutMs !== undefined) {
      contenders.push(new Promise<ComputeJobResult>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          void runtimeAdapter.cancel?.(job.id, `timeout after ${options.timeoutMs}ms`);
          reject(new ComputeAdapterError(`Compute execution timed out after ${options.timeoutMs}ms`, {
            operation: "execute",
            code: "execution_timeout",
            retryable: true,
          }));
        }, options.timeoutMs);
      }));
    }

    if (signal) {
      contenders.push(new Promise<ComputeJobResult>((_, reject) => {
        const onAbort = () => {
          void runtimeAdapter.cancel?.(job.id, "abort signal received");
          reject(new ComputeAdapterError("Compute execution cancelled", {
            operation: "execute",
            code: "execution_cancelled",
            retryable: false,
          }));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        removeAbortListener = () => signal.removeEventListener("abort", onAbort);
      }));
    }

    try {
      return await Promise.race(contenders);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      removeAbortListener?.();
    }
  }

  private withExecutionMetadata(
    result: ComputeJobResult,
    attemptCount: number,
    terminalState: "completed" | "failed" | "cancelled" | "timed_out",
  ): ComputeJobResult {
    return {
      ...result,
      execution: {
        terminalState,
        attemptCount,
        retryableFailure: result.execution?.retryableFailure,
        lastErrorCode: result.execution?.lastErrorCode,
      },
    };
  }

  private descriptorFromFailedResult(result: ComputeJobResult): AdapterErrorDescriptor | undefined {
    if (!result.error) {
      return undefined;
    }

    return {
      adapter: "compute",
      operation: "execute",
      code: result.execution?.lastErrorCode ?? "compute_failed",
      message: result.error,
      retryable: Boolean(result.execution?.retryableFailure),
      occurredAt: Date.now(),
    };
  }

  private createFailedResult(
    jobId: string,
    provider: ComputeProvider,
    attemptCount: number,
    terminalState: "failed" | "cancelled" | "timed_out",
    error: ComputeAdapterError,
  ): ComputeJobResult {
    return {
      jobId,
      providerId: provider.id,
      status: "failed",
      error: error.message,
      usage: {
        id: generateId("usage"),
        jobId,
        providerId: provider.id,
        cpuSeconds: 0,
        memoryMBHours: 0,
        gpuSeconds: 0,
        totalCostCents: 0,
        recordedAt: Date.now(),
      },
      completedAt: Date.now(),
      execution: {
        terminalState,
        attemptCount,
        retryableFailure: error.retryable,
        lastErrorCode: error.code,
      },
    };
  }

  private normalizeExecutionError(error: unknown): ComputeAdapterError {
    if (error instanceof ComputeAdapterError) {
      return error;
    }

    return new ComputeAdapterError(error instanceof Error ? error.message : String(error), {
      operation: "execute",
      code: "execution_failed",
      retryable: false,
      cause: error,
    });
  }

  private async emitCheckpoint(
    checkpoint: ComputeExecutionCheckpoint,
    options?: ComputeDispatchOptions,
  ): Promise<void> {
    await this.checkpointStore?.save(checkpoint);
    await options?.onCheckpoint?.(checkpoint);
  }

  private async delay(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
