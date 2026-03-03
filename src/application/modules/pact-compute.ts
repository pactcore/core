import type { ScheduledJob, Scheduler } from "../contracts";
import { generateId } from "../utils";

export interface ComputeJobInput {
  image: string;
  command: string;
  runAt?: number;
  metadata?: Record<string, string>;
}

export class PactCompute {
  constructor(private readonly scheduler: Scheduler) {}

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
}
