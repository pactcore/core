import type { DisputeRepository } from "../../application/contracts";
import type { DisputeCase } from "../../domain/dispute-resolution";

export class InMemoryDisputeRepository implements DisputeRepository {
  private readonly disputes = new Map<string, DisputeCase>();

  async save(dispute: DisputeCase): Promise<void> {
    this.disputes.set(dispute.id, structuredClone(dispute));
  }

  async getById(id: string): Promise<DisputeCase | undefined> {
    const dispute = this.disputes.get(id);
    return dispute ? structuredClone(dispute) : undefined;
  }

  async list(status?: DisputeCase["status"]): Promise<DisputeCase[]> {
    const items = [...this.disputes.values()]
      .filter((dispute) => (status ? dispute.status === status : true))
      .sort((a, b) => {
        if (a.createdAt === b.createdAt) {
          return a.id.localeCompare(b.id);
        }
        return a.createdAt - b.createdAt;
      });

    return items.map((dispute) => structuredClone(dispute));
  }
}
