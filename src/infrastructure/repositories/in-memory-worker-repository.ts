import type { WorkerRepository } from "../../application/contracts";
import type { WorkerProfile } from "../../domain/types";

export class InMemoryWorkerRepository implements WorkerRepository {
  private readonly workers = new Map<string, WorkerProfile>();

  async save(worker: WorkerProfile): Promise<void> {
    this.workers.set(worker.id, worker);
  }

  async getById(id: string): Promise<WorkerProfile | undefined> {
    return this.workers.get(id);
  }

  async list(): Promise<WorkerProfile[]> {
    return [...this.workers.values()];
  }
}
