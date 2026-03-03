import type {
  HeartbeatExecution,
  HeartbeatSupervisor,
  HeartbeatTask,
  RegisterHeartbeatTaskInput,
  ScheduledJob,
  Scheduler,
} from "../../application/contracts";
import { NotFoundError } from "../../domain/errors";
import { generateId } from "../../application/utils";

const HEARTBEAT_TOPIC = "heartbeat.task";

export class InMemoryHeartbeatSupervisor implements HeartbeatSupervisor {
  private readonly tasks = new Map<string, HeartbeatTask>();

  constructor(private readonly scheduler: Scheduler) {}

  async registerTask(input: RegisterHeartbeatTaskInput): Promise<HeartbeatTask> {
    const now = Date.now();
    const task: HeartbeatTask = {
      id: generateId("heartbeat"),
      name: input.name,
      intervalMs: input.intervalMs,
      enabled: true,
      payload: input.payload,
      nextRunAt: input.startAt ?? now + input.intervalMs,
    };

    this.tasks.set(task.id, task);
    await this.scheduler.schedule(this.toJob(task.id, task.nextRunAt));
    return task;
  }

  async listTasks(): Promise<HeartbeatTask[]> {
    return [...this.tasks.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async enableTask(taskId: string): Promise<HeartbeatTask> {
    const task = this.getOrThrow(taskId);
    if (task.enabled) {
      return task;
    }

    const enabled: HeartbeatTask = {
      ...task,
      enabled: true,
      nextRunAt: Date.now() + task.intervalMs,
    };

    this.tasks.set(taskId, enabled);
    await this.scheduler.schedule(this.toJob(taskId, enabled.nextRunAt));
    return enabled;
  }

  async disableTask(taskId: string): Promise<HeartbeatTask> {
    const task = this.getOrThrow(taskId);
    const disabled: HeartbeatTask = {
      ...task,
      enabled: false,
    };
    this.tasks.set(taskId, disabled);
    return disabled;
  }

  async tick(now = Date.now()): Promise<HeartbeatExecution[]> {
    const dueJobs = await this.scheduler.runDue(now);
    const executions: HeartbeatExecution[] = [];

    for (const job of dueJobs) {
      if (job.topic !== HEARTBEAT_TOPIC) {
        continue;
      }

      const taskId = this.readTaskId(job);
      if (!taskId) {
        continue;
      }

      const task = this.tasks.get(taskId);
      if (!task || !task.enabled) {
        continue;
      }

      // stale job guard: only execute when this job matches current nextRunAt window
      if (job.runAt < task.nextRunAt) {
        continue;
      }

      const executedTask: HeartbeatTask = {
        ...task,
        lastRunAt: now,
        nextRunAt: now + task.intervalMs,
      };

      this.tasks.set(taskId, executedTask);
      await this.scheduler.schedule(this.toJob(taskId, executedTask.nextRunAt));

      executions.push({
        task: executedTask,
        executedAt: now,
      });
    }

    return executions;
  }

  private getOrThrow(taskId: string): HeartbeatTask {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new NotFoundError("HeartbeatTask", taskId);
    }
    return task;
  }

  private toJob(taskId: string, runAt: number): ScheduledJob {
    return {
      id: generateId("heartbeat_job"),
      topic: HEARTBEAT_TOPIC,
      payload: { taskId },
      runAt,
    };
  }

  private readTaskId(job: ScheduledJob): string | undefined {
    if (typeof job.payload !== "object" || !job.payload) {
      return undefined;
    }
    const payload = job.payload as Record<string, unknown>;
    return typeof payload.taskId === "string" ? payload.taskId : undefined;
  }
}
