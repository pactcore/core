import type { ResourceMeter } from "../../application/contracts";
import type { ComputeUsageRecord } from "../../domain/types";

export class InMemoryResourceMeter implements ResourceMeter {
  private readonly records: ComputeUsageRecord[] = [];

  async record(usage: ComputeUsageRecord): Promise<void> {
    this.records.push(usage);
  }

  async getByJob(jobId: string): Promise<ComputeUsageRecord[]> {
    return this.records.filter((r) => r.jobId === jobId);
  }

  async getByProvider(providerId: string): Promise<ComputeUsageRecord[]> {
    return this.records.filter((r) => r.providerId === providerId);
  }

  async listAll(): Promise<ComputeUsageRecord[]> {
    return [...this.records];
  }
}
