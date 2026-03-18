import type { ProvenanceGraph } from "../../application/contracts";
import type { ProvenanceEdge } from "../../domain/types";

export class InMemoryProvenanceGraph implements ProvenanceGraph {
  readonly durability = "memory" as const;

  private readonly edges: ProvenanceEdge[] = [];

  async addEdge(edge: ProvenanceEdge): Promise<void> {
    this.edges.push(edge);
  }

  async getLineage(assetId: string): Promise<ProvenanceEdge[]> {
    // Get all ancestors (edges where assetId is a child)
    const result: ProvenanceEdge[] = [];
    const visited = new Set<string>();
    const queue = [assetId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      for (const edge of this.edges) {
        if (edge.childId === current) {
          result.push(edge);
          queue.push(edge.parentId);
        }
      }
    }

    return result;
  }

  async getDependents(assetId: string): Promise<ProvenanceEdge[]> {
    // Get all descendants (edges where assetId is a parent)
    const result: ProvenanceEdge[] = [];
    const visited = new Set<string>();
    const queue = [assetId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      for (const edge of this.edges) {
        if (edge.parentId === current) {
          result.push(edge);
          queue.push(edge.childId);
        }
      }
    }

    return result;
  }

  getHealth(): { name: string; state: string; checkedAt: number; durable: boolean; durability: string; features: Record<string, unknown> } {
    return {
      name: "provenance-graph",
      state: "healthy",
      checkedAt: Date.now(),
      durable: false,
      durability: this.durability,
      features: {
        lineageTracking: true,
        recordedEdges: this.edges.length,
      },
    };
  }
}
