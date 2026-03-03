import type { TaskRepository } from "../../application/contracts";
import type { Task } from "../../domain/types";

export class InMemoryTaskRepository implements TaskRepository {
  private readonly tasks = new Map<string, Task>();

  async save(task: Task): Promise<void> {
    this.tasks.set(task.id, task);
  }

  async getById(id: string): Promise<Task | undefined> {
    return this.tasks.get(id);
  }

  async list(): Promise<Task[]> {
    return [...this.tasks.values()];
  }
}
