import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { TaskRepository } from "../../application/contracts";
import type { Task } from "../../domain/types";

export interface SQLiteTaskRepositoryOptions {
  filePath: string;
}

interface StoredTaskRow {
  task_json: string;
}

export class SQLiteTaskRepository implements TaskRepository {
  private readonly db: Database;

  constructor(options: SQLiteTaskRepositoryOptions) {
    mkdirSync(dirname(options.filePath), { recursive: true });
    this.db = new Database(options.filePath);
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        task_json TEXT NOT NULL
      )
    `);
  }

  async save(task: Task): Promise<void> {
    this.db.run(
      `
        INSERT INTO tasks (id, task_json)
        VALUES (?, ?)
        ON CONFLICT(id)
        DO UPDATE SET task_json = excluded.task_json
      `,
      task.id,
      JSON.stringify(task),
    );
  }

  async getById(id: string): Promise<Task | undefined> {
    const row = this.db
      .query<StoredTaskRow, [string]>("SELECT task_json FROM tasks WHERE id = ?")
      .get(id);
    if (!row) {
      return undefined;
    }
    return this.parseTask(row.task_json);
  }

  async list(): Promise<Task[]> {
    const rows = this.db
      .query<StoredTaskRow, []>("SELECT task_json FROM tasks ORDER BY rowid ASC")
      .all();
    return rows.map((row) => this.parseTask(row.task_json));
  }

  private parseTask(serialized: string): Task {
    return JSON.parse(serialized) as Task;
  }
}
