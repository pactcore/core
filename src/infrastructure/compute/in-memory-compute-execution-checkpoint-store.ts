import type { AdapterHealthReport, AdapterHealthState } from "../../application/adapter-runtime";
import type { ComputeExecutionCheckpoint, ComputeExecutionCheckpointStore } from "../../application/contracts";

export class InMemoryComputeExecutionCheckpointStore implements ComputeExecutionCheckpointStore {
  private readonly checkpoints = new Map<string, ComputeExecutionCheckpoint[]>();
  private lastError = new Map<string, ComputeExecutionCheckpoint["error"]>();

  async save(checkpoint: ComputeExecutionCheckpoint): Promise<void> {
    const entries = this.checkpoints.get(checkpoint.jobId) ?? [];
    entries.push(cloneCheckpoint(checkpoint));
    this.checkpoints.set(checkpoint.jobId, entries);

    if (checkpoint.error) {
      this.lastError.set(checkpoint.jobId, checkpoint.error);
    }
  }

  async listByJob(jobId: string): Promise<ComputeExecutionCheckpoint[]> {
    return (this.checkpoints.get(jobId) ?? []).map((checkpoint) => cloneCheckpoint(checkpoint));
  }

  async getLatest(jobId: string): Promise<ComputeExecutionCheckpoint | undefined> {
    const entries = this.checkpoints.get(jobId);
    const latest = entries?.at(-1);
    return latest ? cloneCheckpoint(latest) : undefined;
  }

  getHealth(): AdapterHealthReport {
    const totalCheckpoints = [...this.checkpoints.values()].reduce((sum, entries) => sum + entries.length, 0);
    const state: AdapterHealthState = this.lastError.size > 0 ? "degraded" : "healthy";

    return {
      name: "compute-checkpoint-store",
      state,
      checkedAt: Date.now(),
      durable: false,
      durability: "memory",
      features: {
        checkpointing: true,
        jobsTracked: this.checkpoints.size,
        checkpoints: totalCheckpoints,
      },
    };
  }
}

function cloneCheckpoint(checkpoint: ComputeExecutionCheckpoint): ComputeExecutionCheckpoint {
  return {
    ...checkpoint,
    error: checkpoint.error ? { ...checkpoint.error } : undefined,
    metadata: checkpoint.metadata ? { ...checkpoint.metadata } : undefined,
  };
}
