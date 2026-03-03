import type {
  EventBus,
  HeartbeatExecution,
  HeartbeatSupervisor,
  HeartbeatTask,
  RegisterHeartbeatTaskInput,
} from "../contracts";
import { DomainEvents } from "../events";

export class PactHeartbeat {
  constructor(
    private readonly supervisor: HeartbeatSupervisor,
    private readonly eventBus: EventBus,
  ) {}

  async registerTask(input: RegisterHeartbeatTaskInput): Promise<HeartbeatTask> {
    const task = await this.supervisor.registerTask(input);
    await this.eventBus.publish({
      name: DomainEvents.HeartbeatTaskRegistered,
      payload: { task },
      createdAt: Date.now(),
    });
    return task;
  }

  async listTasks(): Promise<HeartbeatTask[]> {
    return this.supervisor.listTasks();
  }

  async enableTask(taskId: string): Promise<HeartbeatTask> {
    const task = await this.supervisor.enableTask(taskId);
    await this.eventBus.publish({
      name: DomainEvents.HeartbeatTaskEnabled,
      payload: { taskId: task.id },
      createdAt: Date.now(),
    });
    return task;
  }

  async disableTask(taskId: string): Promise<HeartbeatTask> {
    const task = await this.supervisor.disableTask(taskId);
    await this.eventBus.publish({
      name: DomainEvents.HeartbeatTaskDisabled,
      payload: { taskId: task.id },
      createdAt: Date.now(),
    });
    return task;
  }

  async tick(now?: number): Promise<HeartbeatExecution[]> {
    const executions = await this.supervisor.tick(now);
    for (const execution of executions) {
      await this.eventBus.publish({
        name: DomainEvents.HeartbeatTaskExecuted,
        payload: {
          taskId: execution.task.id,
          taskName: execution.task.name,
          executedAt: execution.executedAt,
        },
        createdAt: Date.now(),
      });
    }
    return executions;
  }
}
