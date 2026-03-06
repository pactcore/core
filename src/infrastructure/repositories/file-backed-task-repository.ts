import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TaskRepository } from "../../application/contracts";
import type { Task } from "../../domain/types";
import {
  compareDeterministicCursor,
  decodeDeterministicCursor,
  encodeDeterministicCursor,
  normalizePositiveLimit,
  type DeterministicCursorPayload,
} from "./file-backed-cursor";

const DEFAULT_QUERY_LIMIT = 50;
const MAX_QUERY_LIMIT = 200;
const DEFAULT_REPLAY_LIMIT = 100;
const MAX_REPLAY_LIMIT = 500;

export interface FileBackedTaskRepositoryOptions {
  filePath: string;
}

export interface TaskQueryFilter {
  id?: string;
  issuerId?: string;
  assigneeId?: string;
  status?: Task["status"];
  validatorId?: string;
  createdAfter?: number;
  createdBefore?: number;
  updatedAfter?: number;
  updatedBefore?: number;
}

export interface TaskPageRequest {
  cursor?: string;
  limit?: number;
}

export interface TaskPage {
  items: Task[];
  nextCursor?: string;
}

export type TaskLifecycleAction = "created" | "updated";

export interface TaskLifecycleEntry {
  offset: number;
  action: TaskLifecycleAction;
  taskId: string;
  status: Task["status"];
  occurredAt: number;
  task: Task;
}

export interface TaskReplayRequest {
  cursor?: string;
  limit?: number;
}

export interface TaskReplayPage {
  entries: TaskLifecycleEntry[];
  nextCursor?: string;
}

interface StoredTaskRecord {
  order: number;
  task: Task;
}

interface StoredTaskState {
  version: 1;
  tasks: StoredTaskRecord[];
  lifecycle: TaskLifecycleEntry[];
}

export class FileBackedTaskRepository implements TaskRepository {
  private readonly filePath: string;
  private readonly tasks = new Map<string, StoredTaskRecord>();
  private lifecycle = new Array<TaskLifecycleEntry>();
  private nextOrder = 0;
  private readonly loaded: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: FileBackedTaskRepositoryOptions) {
    this.filePath = options.filePath;
    this.loaded = this.loadFromDisk();
  }

  async save(task: Task): Promise<void> {
    await this.withWriteLock(async () => {
      const existing = this.tasks.get(task.id);
      const snapshot = this.cloneTask(task);
      const record: StoredTaskRecord = {
        order: existing?.order ?? this.nextOrder++,
        task: snapshot,
      };

      this.tasks.set(snapshot.id, record);
      this.appendLifecycle(existing ? "updated" : "created", record, this.resolveOccurredAt(existing, snapshot));
      await this.persistToDisk();
    });
  }

  async getById(id: string): Promise<Task | undefined> {
    await this.loaded;
    const record = this.tasks.get(id);
    return record ? this.cloneTask(record.task) : undefined;
  }

  async list(): Promise<Task[]> {
    await this.loaded;
    return this.listRecords().map((record) => this.cloneTask(record.task));
  }

  async query(filter?: TaskQueryFilter, page?: TaskPageRequest): Promise<TaskPage> {
    await this.loaded;
    const cursor = decodeDeterministicCursor(page?.cursor);
    const limit = normalizePositiveLimit(page?.limit, DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);
    const matching = this.listRecords().filter((record) => this.matchesFilter(record.task, filter));
    const startIndex = this.resolveStartIndex(matching, cursor, (record) => this.recordCursor(record));
    const pageItems = matching.slice(startIndex, startIndex + limit);
    const items = pageItems.map((record) => this.cloneTask(record.task));
    const nextCursor = startIndex + limit < matching.length
      ? encodeDeterministicCursor(this.recordCursor(pageItems[pageItems.length - 1]!))
      : undefined;

    return {
      items,
      nextCursor,
    };
  }

  async replay(request: TaskReplayRequest = {}): Promise<TaskReplayPage> {
    await this.loaded;
    const cursor = decodeDeterministicCursor(request.cursor, "replay cursor");
    const limit = normalizePositiveLimit(request.limit, DEFAULT_REPLAY_LIMIT, MAX_REPLAY_LIMIT);
    const startIndex = this.resolveStartIndex(this.lifecycle, cursor, (entry) => this.lifecycleCursor(entry));
    const pageEntries = this.lifecycle.slice(startIndex, startIndex + limit);
    const entries = pageEntries.map((entry) => this.cloneLifecycleEntry(entry));
    const nextCursor = startIndex + limit < this.lifecycle.length
      ? encodeDeterministicCursor(this.lifecycleCursor(pageEntries[pageEntries.length - 1]!))
      : undefined;

    return {
      entries,
      nextCursor,
    };
  }

  private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.loaded;

    const previous = this.writeQueue;
    let release: (() => void) | undefined;
    this.writeQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await fn();
    } finally {
      release?.();
    }
  }

  private async loadFromDisk(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") {
        return;
      }
      throw error;
    }

    const parsed = JSON.parse(raw) as Partial<StoredTaskState>;

    if (Array.isArray(parsed.tasks)) {
      for (const [index, candidate] of parsed.tasks.entries()) {
        const normalized = this.normalizeTaskRecord(candidate, index);
        if (!normalized) {
          continue;
        }

        const existing = this.tasks.get(normalized.task.id);
        this.tasks.set(normalized.task.id, {
          order: existing?.order ?? normalized.order,
          task: normalized.task,
        });
      }
    }

    this.nextOrder = this.tasks.size > 0
      ? Math.max(...[...this.tasks.values()].map((record) => record.order)) + 1
      : 0;

    if (Array.isArray(parsed.lifecycle)) {
      this.lifecycle = parsed.lifecycle
        .map((entry) => this.normalizeLifecycleEntry(entry))
        .filter((entry): entry is TaskLifecycleEntry => entry !== undefined)
        .map((entry, index) => ({
          ...entry,
          offset: index,
        }));
    }
  }

  private normalizeTaskRecord(candidate: unknown, index: number): StoredTaskRecord | undefined {
    if (!candidate || typeof candidate !== "object") {
      return undefined;
    }

    if ("task" in candidate) {
      const record = candidate as Partial<StoredTaskRecord>;
      if (!record.task || typeof record.task !== "object" || typeof record.task.id !== "string") {
        return undefined;
      }

      return {
        order: Number.isInteger(record.order) && record.order! >= 0 ? record.order! : index,
        task: this.cloneTask(record.task as Task),
      };
    }

    const task = candidate as Partial<Task>;
    if (typeof task.id !== "string") {
      return undefined;
    }

    return {
      order: index,
      task: this.cloneTask(task as Task),
    };
  }

  private normalizeLifecycleEntry(candidate: unknown): TaskLifecycleEntry | undefined {
    if (!candidate || typeof candidate !== "object") {
      return undefined;
    }

    const entry = candidate as Partial<TaskLifecycleEntry>;
    const action = entry.action === "updated" ? "updated" : entry.action === "created" ? "created" : undefined;
    if (!action || !entry.task || typeof entry.task !== "object" || typeof entry.task.id !== "string") {
      return undefined;
    }

    const task = this.cloneTask(entry.task as Task);
    const current = this.tasks.get(task.id)?.task;
    const snapshot = current ? this.cloneTask(current) : task;

    return {
      offset: 0,
      action,
      taskId: snapshot.id,
      status: snapshot.status,
      occurredAt: typeof entry.occurredAt === "number" ? entry.occurredAt : snapshot.updatedAt,
      task: snapshot,
    };
  }

  private async persistToDisk(): Promise<void> {
    const tasks = this.listRecords().map((record) => this.cloneTaskRecord(record));
    const lifecycle = this.lifecycle.map((entry, offset) => ({
      ...this.cloneLifecycleEntry(entry),
      offset,
    }));
    this.lifecycle = lifecycle;

    const state: StoredTaskState = {
      version: 1,
      tasks,
      lifecycle,
    };

    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
    await rename(tempPath, this.filePath);
  }

  private listRecords(): StoredTaskRecord[] {
    return [...this.tasks.values()].sort((left, right) => {
      if (left.order === right.order) {
        return left.task.id.localeCompare(right.task.id);
      }

      return left.order - right.order;
    });
  }

  private matchesFilter(task: Task, filter?: TaskQueryFilter): boolean {
    if (!filter) {
      return true;
    }
    if (filter.id && task.id !== filter.id) {
      return false;
    }
    if (filter.issuerId && task.issuerId !== filter.issuerId) {
      return false;
    }
    if (filter.assigneeId && task.assigneeId !== filter.assigneeId) {
      return false;
    }
    if (filter.status && task.status !== filter.status) {
      return false;
    }
    if (filter.validatorId && !task.validatorIds.includes(filter.validatorId)) {
      return false;
    }
    if (filter.createdAfter !== undefined && task.createdAt < filter.createdAfter) {
      return false;
    }
    if (filter.createdBefore !== undefined && task.createdAt > filter.createdBefore) {
      return false;
    }
    if (filter.updatedAfter !== undefined && task.updatedAt < filter.updatedAfter) {
      return false;
    }
    if (filter.updatedBefore !== undefined && task.updatedAt > filter.updatedBefore) {
      return false;
    }

    return true;
  }

  private appendLifecycle(action: TaskLifecycleAction, record: StoredTaskRecord, occurredAt: number): void {
    this.lifecycle.push({
      offset: this.lifecycle.length,
      action,
      taskId: record.task.id,
      status: record.task.status,
      occurredAt,
      task: this.cloneTask(record.task),
    });
  }

  private resolveOccurredAt(existing: StoredTaskRecord | undefined, task: Task): number {
    return existing ? task.updatedAt : task.createdAt;
  }

  private resolveStartIndex<T>(
    items: T[],
    cursor: DeterministicCursorPayload | undefined,
    selector: (item: T) => DeterministicCursorPayload,
  ): number {
    if (!cursor) {
      return 0;
    }

    const index = items.findIndex((item) => compareDeterministicCursor(selector(item), cursor) > 0);
    return index === -1 ? items.length : index;
  }

  private recordCursor(record: StoredTaskRecord): DeterministicCursorPayload {
    return {
      position: record.order,
      id: record.task.id,
    };
  }

  private lifecycleCursor(entry: TaskLifecycleEntry): DeterministicCursorPayload {
    return {
      position: entry.offset,
      id: entry.taskId,
    };
  }

  private cloneTaskRecord(record: StoredTaskRecord): StoredTaskRecord {
    return {
      order: record.order,
      task: this.cloneTask(record.task),
    };
  }

  private cloneTask(task: Task): Task {
    return structuredClone(task);
  }

  private cloneLifecycleEntry(entry: TaskLifecycleEntry): TaskLifecycleEntry {
    return {
      ...entry,
      task: this.cloneTask(entry.task),
    };
  }
}
