import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  MissionLifecycleAction,
  MissionLifecycleEntry,
  MissionPage,
  MissionPageRequest,
  MissionQueryFilter,
  MissionReplayPage,
  MissionReplayRequest,
  MissionRepository,
} from "../../application/contracts";
import type { MissionEnvelope } from "../../domain/types";

const DEFAULT_QUERY_LIMIT = 50;
const MAX_QUERY_LIMIT = 200;
const DEFAULT_REPLAY_LIMIT = 100;
const MAX_REPLAY_LIMIT = 500;

interface StoredMissionState {
  missions: MissionEnvelope[];
  lifecycle: MissionLifecycleEntry[];
}

export interface FileBackedMissionRepositoryOptions {
  filePath: string;
}

export class FileBackedMissionRepository implements MissionRepository {
  private readonly filePath: string;
  private readonly missions = new Map<string, MissionEnvelope>();
  private lifecycle = new Array<MissionLifecycleEntry>();
  private readonly loaded: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: FileBackedMissionRepositoryOptions) {
    this.filePath = options.filePath;
    this.loaded = this.loadFromDisk();
  }

  async save(mission: MissionEnvelope): Promise<void> {
    await this.withWriteLock(async () => {
      const action: MissionLifecycleAction = this.missions.has(mission.id) ? "updated" : "created";
      const snapshot = this.cloneMission(mission);

      this.missions.set(snapshot.id, snapshot);
      this.appendLifecycle(action, snapshot, this.resolveOccurredAt(action, snapshot));
      await this.persistToDisk();
    });
  }

  async getById(id: string): Promise<MissionEnvelope | undefined> {
    await this.loaded;
    const mission = this.missions.get(id);
    return mission ? this.cloneMission(mission) : undefined;
  }

  async list(): Promise<MissionEnvelope[]> {
    await this.loaded;
    return [...this.missions.values()]
      .sort((a, b) => {
        if (a.createdAt === b.createdAt) {
          return a.id.localeCompare(b.id);
        }
        return a.createdAt - b.createdAt;
      })
      .map((mission) => this.cloneMission(mission));
  }

  async query(filter?: MissionQueryFilter, page?: MissionPageRequest): Promise<MissionPage> {
    await this.loaded;
    const cursor = this.parseCursor(page?.cursor);
    const limit = this.normalizeLimit(page?.limit, DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);

    const matching = [...this.missions.values()]
      .filter((mission) => this.matchesFilter(mission, filter))
      .sort((a, b) => {
        if (a.createdAt === b.createdAt) {
          return a.id.localeCompare(b.id);
        }
        return a.createdAt - b.createdAt;
      });

    if (cursor >= matching.length) {
      return { items: [] };
    }

    const items = matching.slice(cursor, cursor + limit).map((mission) => this.cloneMission(mission));
    const nextCursor = cursor + limit < matching.length ? String(cursor + limit) : undefined;

    return {
      items,
      nextCursor,
    };
  }

  async replay(request: MissionReplayRequest = {}): Promise<MissionReplayPage> {
    await this.loaded;
    const fromOffset = this.normalizeOffset(request.fromOffset, "fromOffset");
    const limit = this.normalizeLimit(request.limit, DEFAULT_REPLAY_LIMIT, MAX_REPLAY_LIMIT);
    const entries = this.lifecycle
      .slice(fromOffset, fromOffset + limit)
      .map((entry) => this.cloneLifecycleEntry(entry));

    const nextOffset = fromOffset + limit < this.lifecycle.length ? fromOffset + limit : undefined;

    return {
      entries,
      nextOffset,
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

    const parsed = JSON.parse(raw) as Partial<StoredMissionState>;

    if (Array.isArray(parsed.missions)) {
      for (const candidate of parsed.missions) {
        if (candidate && typeof candidate.id === "string") {
          this.missions.set(candidate.id, this.cloneMission(candidate));
        }
      }
    }

    if (Array.isArray(parsed.lifecycle)) {
      this.lifecycle = parsed.lifecycle
        .map((entry) => this.normalizeLifecycleEntry(entry))
        .filter((entry): entry is MissionLifecycleEntry => entry !== undefined)
        .map((entry, index) => ({ ...entry, offset: index }));
    }
  }

  private normalizeLifecycleEntry(entry: MissionLifecycleEntry): MissionLifecycleEntry | undefined {
    if (!entry || typeof entry !== "object") {
      return undefined;
    }

    const action = entry.action === "updated" ? "updated" : entry.action === "created" ? "created" : undefined;
    if (!action || !entry.mission || typeof entry.mission.id !== "string") {
      return undefined;
    }

    const mission = this.cloneMission(entry.mission);
    const existing = this.missions.get(mission.id);
    const snapshot = existing ? this.cloneMission(existing) : mission;

    return {
      offset: 0,
      action,
      missionId: snapshot.id,
      status: snapshot.status,
      occurredAt: typeof entry.occurredAt === "number" ? entry.occurredAt : this.resolveOccurredAt(action, snapshot),
      mission: snapshot,
    };
  }

  private async persistToDisk(): Promise<void> {
    const missions = [...this.missions.values()]
      .sort((a, b) => {
        if (a.createdAt === b.createdAt) {
          return a.id.localeCompare(b.id);
        }
        return a.createdAt - b.createdAt;
      })
      .map((mission) => this.cloneMission(mission));

    const lifecycle = this.lifecycle.map((entry, index) => ({
      ...this.cloneLifecycleEntry(entry),
      offset: index,
    }));
    this.lifecycle = lifecycle;

    const state: StoredMissionState = {
      missions,
      lifecycle,
    };

    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
    await rename(tempPath, this.filePath);
  }

  private matchesFilter(mission: MissionEnvelope, filter?: MissionQueryFilter): boolean {
    if (!filter) {
      return true;
    }

    if (filter.id && mission.id !== filter.id) {
      return false;
    }
    if (filter.issuerId && mission.issuerId !== filter.issuerId) {
      return false;
    }
    if (filter.status && mission.status !== filter.status) {
      return false;
    }
    if (filter.claimedBy && mission.claimedBy !== filter.claimedBy) {
      return false;
    }
    if (filter.targetAgentId && !mission.targetAgentIds.includes(filter.targetAgentId)) {
      return false;
    }
    if (filter.createdAfter !== undefined && mission.createdAt < filter.createdAfter) {
      return false;
    }
    if (filter.createdBefore !== undefined && mission.createdAt > filter.createdBefore) {
      return false;
    }
    if (filter.updatedAfter !== undefined && mission.updatedAt < filter.updatedAfter) {
      return false;
    }
    if (filter.updatedBefore !== undefined && mission.updatedAt > filter.updatedBefore) {
      return false;
    }

    return true;
  }

  private appendLifecycle(action: MissionLifecycleAction, mission: MissionEnvelope, occurredAt: number): void {
    this.lifecycle.push({
      offset: this.lifecycle.length,
      action,
      missionId: mission.id,
      status: mission.status,
      occurredAt,
      mission: this.cloneMission(mission),
    });
  }

  private resolveOccurredAt(action: MissionLifecycleAction, mission: MissionEnvelope): number {
    if (action === "created") {
      return mission.createdAt;
    }
    return mission.updatedAt;
  }

  private cloneMission(mission: MissionEnvelope): MissionEnvelope {
    return structuredClone(mission);
  }

  private cloneLifecycleEntry(entry: MissionLifecycleEntry): MissionLifecycleEntry {
    return {
      ...entry,
      mission: this.cloneMission(entry.mission),
    };
  }

  private parseCursor(cursor?: string): number {
    if (!cursor) {
      return 0;
    }

    const parsed = Number(cursor);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`invalid cursor: ${cursor}`);
    }

    return parsed;
  }

  private normalizeOffset(value: number | undefined, label: string): number {
    if (value === undefined) {
      return 0;
    }

    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`invalid ${label}: ${value}`);
    }

    return value;
  }

  private normalizeLimit(value: number | undefined, fallback: number, max: number): number {
    if (value === undefined) {
      return fallback;
    }

    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`invalid limit: ${value}`);
    }

    return Math.min(value, max);
  }
}
