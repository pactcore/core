import type { TaskManager, TaskRepository } from "../../application/contracts";
import { NotFoundError } from "../../domain/errors";
import { TaskStateMachine } from "../../domain/task-state-machine";
import type { Task, TaskEvidence, TaskStatus } from "../../domain/types";

export class InMemoryTaskManager implements TaskManager {
  constructor(
    private readonly repository: TaskRepository,
    private readonly stateMachine: TaskStateMachine,
  ) {}

  async create(task: Task): Promise<Task> {
    await this.repository.save(task);
    return task;
  }

  async assign(taskId: string, workerId: string): Promise<Task> {
    const task = await this.getOrThrow(taskId);
    const transitioned = this.stateMachine.transition(
      {
        ...task,
        assigneeId: workerId,
      },
      "Assigned",
    );
    await this.repository.save(transitioned);
    return transitioned;
  }

  async submit(taskId: string, evidence: TaskEvidence): Promise<Task> {
    const task = await this.getOrThrow(taskId);
    const transitioned = this.stateMachine.transition(
      {
        ...task,
        evidence,
      },
      "Submitted",
    );
    await this.repository.save(transitioned);
    return transitioned;
  }

  async verify(taskId: string, validatorIds: string[]): Promise<Task> {
    const task = await this.getOrThrow(taskId);
    const transitioned = this.stateMachine.transition(
      {
        ...task,
        validatorIds,
      },
      "Verified",
    );
    await this.repository.save(transitioned);
    return transitioned;
  }

  async complete(taskId: string): Promise<Task> {
    const task = await this.getOrThrow(taskId);
    const transitioned = this.stateMachine.transition(task, "Completed");
    await this.repository.save(transitioned);
    return transitioned;
  }

  async setStatus(taskId: string, status: TaskStatus): Promise<Task> {
    const task = await this.getOrThrow(taskId);
    const transitioned = this.stateMachine.transition(task, status);
    await this.repository.save(transitioned);
    return transitioned;
  }

  async get(taskId: string): Promise<Task | undefined> {
    return this.repository.getById(taskId);
  }

  async list(): Promise<Task[]> {
    return this.repository.list();
  }

  private async getOrThrow(taskId: string): Promise<Task> {
    const task = await this.repository.getById(taskId);
    if (!task) {
      throw new NotFoundError("Task", taskId);
    }
    return task;
  }
}
