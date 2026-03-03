import { DomainEvents } from "../events";
import type { EventBus, TaskManager, WorkerRepository } from "../contracts";
import { NotFoundError } from "../../domain/errors";
import { GaleShapleyMatcher } from "../../domain/matching";
import type { Task, TaskConstraints, TaskEvidence } from "../../domain/types";
import { generateId } from "../utils";
import { PactPay } from "./pact-pay";

export interface CreateTaskInput {
  title: string;
  description: string;
  issuerId: string;
  paymentCents: number;
  location: {
    latitude: number;
    longitude: number;
  };
  constraints: TaskConstraints;
}

export class PactTasks {
  private readonly matcher = new GaleShapleyMatcher();

  constructor(
    private readonly taskManager: TaskManager,
    private readonly workerRepository: WorkerRepository,
    private readonly eventBus: EventBus,
    private readonly pactPay: PactPay,
  ) {}

  async createTask(input: CreateTaskInput): Promise<Task> {
    const now = Date.now();
    const task: Task = {
      id: generateId("task"),
      title: input.title,
      description: input.description,
      issuerId: input.issuerId,
      paymentCents: input.paymentCents,
      constraints: input.constraints,
      location: input.location,
      status: "Created",
      validatorIds: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.pactPay.createEscrow(task);
    const created = await this.taskManager.create(task);
    await this.eventBus.publish({
      name: DomainEvents.TaskCreated,
      payload: { task: created },
      createdAt: Date.now(),
    });

    return created;
  }

  async assignTask(taskId: string, workerId: string): Promise<Task> {
    const task = await this.getTask(taskId);
    const worker = await this.workerRepository.getById(workerId);
    if (!worker) {
      throw new NotFoundError("Worker", workerId);
    }

    this.matcher.assertAssignable(task, worker);

    const assigned = await this.taskManager.assign(taskId, workerId);
    await this.workerRepository.save({
      ...worker,
      activeTaskIds: [...worker.activeTaskIds, taskId],
    });

    await this.eventBus.publish({
      name: DomainEvents.TaskAssigned,
      payload: { task: assigned },
      createdAt: Date.now(),
    });

    return assigned;
  }

  async autoAssignTask(taskId: string): Promise<Task> {
    const task = await this.getTask(taskId);
    const workers = await this.workerRepository.list();
    const result = this.matcher.match([task], workers);
    const assignment = result.assignments.find((entry) => entry.taskId === task.id);
    if (!assignment) {
      throw new Error(`No worker can satisfy task ${task.id}`);
    }

    return this.assignTask(task.id, assignment.workerId);
  }

  async submitEvidence(taskId: string, evidence: TaskEvidence): Promise<Task> {
    const submitted = await this.taskManager.submit(taskId, evidence);
    await this.eventBus.publish({
      name: DomainEvents.TaskSubmitted,
      payload: { task: submitted },
      createdAt: Date.now(),
    });
    return submitted;
  }

  async markVerified(taskId: string, validatorIds: string[]): Promise<Task> {
    const verified = await this.taskManager.verify(taskId, validatorIds);
    await this.eventBus.publish({
      name: DomainEvents.TaskVerified,
      payload: { task: verified },
      createdAt: Date.now(),
    });
    return verified;
  }

  async markCompleted(taskId: string): Promise<Task> {
    const completed = await this.taskManager.complete(taskId);

    if (completed.assigneeId) {
      const worker = await this.workerRepository.getById(completed.assigneeId);
      if (worker) {
        await this.workerRepository.save({
          ...worker,
          activeTaskIds: worker.activeTaskIds.filter((id) => id !== taskId),
        });
      }
    }

    await this.eventBus.publish({
      name: DomainEvents.TaskCompleted,
      payload: { task: completed },
      createdAt: Date.now(),
    });

    return completed;
  }

  async getTask(taskId: string): Promise<Task> {
    const task = await this.taskManager.get(taskId);
    if (!task) {
      throw new NotFoundError("Task", taskId);
    }
    return task;
  }

  async listTasks(): Promise<Task[]> {
    return this.taskManager.list();
  }
}
