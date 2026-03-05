import type {
  ComputeExecutionAdapter,
  ComputeProviderRegistry,
  ResourceMeter,
  ScheduledJob,
  Scheduler,
} from "../contracts";
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
  constructor(
    private readonly scheduler: Scheduler,
    private readonly providerRegistry: ComputeProviderRegistry,
    private readonly resourceMeter: ResourceMeter,
    private readonly executionAdapter: ComputeExecutionAdapter,
    private readonly pricingEngine?: ComputePricingEngine,
  ) {}

  // ── Provider management ────────────────────────────────────

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

  // ── Job scheduling ─────────────────────────────────────────

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
    return job;
  }

  async runDue(now?: number): Promise<ScheduledJob[]> {
    return this.scheduler.runDue(now);
  }

  // ── Job dispatch & metering ────────────────────────────────

  async dispatchJob(jobId: string, providerId?: string): Promise<ComputeJobResult> {
    // Find or auto-select provider
    let provider: ComputeProvider | undefined;

    if (providerId) {
      provider = await this.providerRegistry.getProvider(providerId);
      if (!provider) {
        throw new Error(`Provider ${providerId} not found`);
      }
    } else {
      const available = await this.providerRegistry.findProvidersByCapability(1, 1);
      if (available.length === 0) {
        throw new Error("No available compute providers");
      }
      provider = available[0];
    }

    // Build a ScheduledJob representation for the adapter
    const job: ScheduledJob = {
      id: jobId,
      topic: "compute.exec",
      payload: {},
      runAt: Date.now(),
    };

    const result = await this.executionAdapter.execute(job, provider);

    // Record metering
    await this.resourceMeter.record(result.usage);

    return result;
  }

  async getUsageRecords(jobId?: string): Promise<ComputeUsageRecord[]> {
    if (jobId) {
      return this.resourceMeter.getByJob(jobId);
    }
    return this.resourceMeter.listAll();
  }
}
