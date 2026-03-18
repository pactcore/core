import type { Database } from "bun:sqlite";
import type { AdapterHealthReport } from "../../application/adapter-runtime";
import type { ProvenanceGraph } from "../../application/contracts";
import type { ProvenanceEdge } from "../../domain/types";
import { openSQLiteDataDatabase } from "./sqlite-data-database";

export interface SQLiteProvenanceGraphOptions {
  filePath: string;
}

interface StoredProvenanceEdgeRow {
  edge_json: string;
}

export class SQLiteProvenanceGraph implements ProvenanceGraph {
  readonly durability = "database" as const;

  private readonly db: Database;

  constructor(options: SQLiteProvenanceGraphOptions) {
    this.db = openSQLiteDataDatabase(options.filePath);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS data_provenance_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        child_id TEXT NOT NULL,
        parent_id TEXT NOT NULL,
        edge_json TEXT NOT NULL
      )
    `);
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_data_provenance_edges_child_id ON data_provenance_edges (child_id)",
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_data_provenance_edges_parent_id ON data_provenance_edges (parent_id)",
    );
  }

  isDurable(): boolean {
    return true;
  }

  async addEdge(edge: ProvenanceEdge): Promise<void> {
    this.db.run(
      `
        INSERT INTO data_provenance_edges (child_id, parent_id, edge_json)
        VALUES (?, ?, ?)
      `,
      edge.childId,
      edge.parentId,
      JSON.stringify(edge),
    );
  }

  async getLineage(assetId: string): Promise<ProvenanceEdge[]> {
    return this.collectEdges(assetId, "lineage");
  }

  async getDependents(assetId: string): Promise<ProvenanceEdge[]> {
    return this.collectEdges(assetId, "dependents");
  }

  getHealth(): AdapterHealthReport {
    const count = this.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM data_provenance_edges")
      .get()?.count ?? 0;
    return {
      name: "provenance-graph",
      state: "healthy",
      checkedAt: Date.now(),
      durable: true,
      durability: this.durability,
      features: {
        lineageTracking: true,
        recordedEdges: count,
      },
    };
  }

  private collectEdges(assetId: string, mode: "lineage" | "dependents"): ProvenanceEdge[] {
    const rows = this.db
      .query<StoredProvenanceEdgeRow, []>(
        "SELECT edge_json FROM data_provenance_edges ORDER BY id ASC",
      )
      .all();
    const edges = rows.map((row) => JSON.parse(row.edge_json) as ProvenanceEdge);
    const result: ProvenanceEdge[] = [];
    const visited = new Set<string>();
    const queue = [assetId];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) {
        continue;
      }
      visited.add(current);

      for (const edge of edges) {
        if (mode === "lineage" && edge.childId === current) {
          result.push(edge);
          queue.push(edge.parentId);
        }
        if (mode === "dependents" && edge.parentId === current) {
          result.push(edge);
          queue.push(edge.childId);
        }
      }
    }

    return result;
  }
}
