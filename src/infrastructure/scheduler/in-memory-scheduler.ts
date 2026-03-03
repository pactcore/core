import type { ScheduledJob, Scheduler } from "../../application/contracts";

export class InMemoryScheduler implements Scheduler {
  private readonly jobs: ScheduledJob[] = [];

  async schedule(job: ScheduledJob): Promise<void> {
    this.jobs.push(job);
    this.jobs.sort((a, b) => a.runAt - b.runAt);
  }

  async runDue(now = Date.now()): Promise<ScheduledJob[]> {
    const due: ScheduledJob[] = [];
    const pending: ScheduledJob[] = [];

    for (const job of this.jobs) {
      if (job.runAt <= now) {
        due.push(job);
      } else {
        pending.push(job);
      }
    }

    this.jobs.length = 0;
    this.jobs.push(...pending);
    return due;
  }
}
