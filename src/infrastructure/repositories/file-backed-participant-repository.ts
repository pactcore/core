import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ParticipantRepository } from "../../application/contracts";
import type { Participant } from "../../domain/types";
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

export interface FileBackedParticipantRepositoryOptions {
  filePath: string;
}

export interface ParticipantQueryFilter {
  id?: string;
  role?: Participant["role"];
  skill?: string;
  identityLevel?: Participant["identityLevel"];
}

export interface ParticipantPageRequest {
  cursor?: string;
  limit?: number;
}

export interface ParticipantPage {
  items: Participant[];
  nextCursor?: string;
}

export type ParticipantLifecycleAction = "created" | "updated";

export interface ParticipantLifecycleEntry {
  offset: number;
  action: ParticipantLifecycleAction;
  participantId: string;
  role: Participant["role"];
  occurredAt: number;
  participant: Participant;
}

export interface ParticipantReplayRequest {
  cursor?: string;
  limit?: number;
}

export interface ParticipantReplayPage {
  entries: ParticipantLifecycleEntry[];
  nextCursor?: string;
}

interface StoredParticipantRecord {
  order: number;
  participant: Participant;
}

interface StoredParticipantState {
  version: 1;
  participants: StoredParticipantRecord[];
  lifecycle: ParticipantLifecycleEntry[];
}

export class FileBackedParticipantRepository implements ParticipantRepository {
  private readonly filePath: string;
  private readonly participants = new Map<string, StoredParticipantRecord>();
  private lifecycle = new Array<ParticipantLifecycleEntry>();
  private nextOrder = 0;
  private readonly loaded: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: FileBackedParticipantRepositoryOptions) {
    this.filePath = options.filePath;
    this.loaded = this.loadFromDisk();
  }

  async save(participant: Participant): Promise<void> {
    await this.withWriteLock(async () => {
      const existing = this.participants.get(participant.id);
      const snapshot = this.cloneParticipant(participant);
      const record: StoredParticipantRecord = {
        order: existing?.order ?? this.nextOrder++,
        participant: snapshot,
      };

      this.participants.set(snapshot.id, record);
      this.appendLifecycle(existing ? "updated" : "created", record);
      await this.persistToDisk();
    });
  }

  async getById(id: string): Promise<Participant | undefined> {
    await this.loaded;
    const record = this.participants.get(id);
    return record ? this.cloneParticipant(record.participant) : undefined;
  }

  async listByRole(role: Participant["role"]): Promise<Participant[]> {
    await this.loaded;
    return this.listRecords()
      .filter((record) => record.participant.role === role)
      .map((record) => this.cloneParticipant(record.participant));
  }

  async query(filter?: ParticipantQueryFilter, page?: ParticipantPageRequest): Promise<ParticipantPage> {
    await this.loaded;
    const cursor = decodeDeterministicCursor(page?.cursor);
    const limit = normalizePositiveLimit(page?.limit, DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);
    const matching = this.listRecords().filter((record) => this.matchesFilter(record.participant, filter));
    const startIndex = this.resolveStartIndex(matching, cursor, (record) => this.recordCursor(record));
    const pageItems = matching.slice(startIndex, startIndex + limit);
    const items = pageItems.map((record) => this.cloneParticipant(record.participant));
    const nextCursor = startIndex + limit < matching.length
      ? encodeDeterministicCursor(this.recordCursor(pageItems[pageItems.length - 1]!))
      : undefined;

    return {
      items,
      nextCursor,
    };
  }

  async replay(request: ParticipantReplayRequest = {}): Promise<ParticipantReplayPage> {
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

    const parsed = JSON.parse(raw) as Partial<StoredParticipantState>;

    if (Array.isArray(parsed.participants)) {
      for (const [index, candidate] of parsed.participants.entries()) {
        const normalized = this.normalizeParticipantRecord(candidate, index);
        if (!normalized) {
          continue;
        }

        const existing = this.participants.get(normalized.participant.id);
        this.participants.set(normalized.participant.id, {
          order: existing?.order ?? normalized.order,
          participant: normalized.participant,
        });
      }
    }

    this.nextOrder = this.participants.size > 0
      ? Math.max(...[...this.participants.values()].map((record) => record.order)) + 1
      : 0;

    if (Array.isArray(parsed.lifecycle)) {
      this.lifecycle = parsed.lifecycle
        .map((entry) => this.normalizeLifecycleEntry(entry))
        .filter((entry): entry is ParticipantLifecycleEntry => entry !== undefined)
        .map((entry, index) => ({
          ...entry,
          offset: index,
        }));
    }
  }

  private normalizeParticipantRecord(candidate: unknown, index: number): StoredParticipantRecord | undefined {
    if (!candidate || typeof candidate !== "object") {
      return undefined;
    }

    if ("participant" in candidate) {
      const record = candidate as Partial<StoredParticipantRecord>;
      if (!record.participant || typeof record.participant !== "object" || typeof record.participant.id !== "string") {
        return undefined;
      }

      return {
        order: Number.isInteger(record.order) && record.order! >= 0 ? record.order! : index,
        participant: this.cloneParticipant(record.participant as Participant),
      };
    }

    const participant = candidate as Partial<Participant>;
    if (typeof participant.id !== "string") {
      return undefined;
    }

    return {
      order: index,
      participant: this.cloneParticipant(participant as Participant),
    };
  }

  private normalizeLifecycleEntry(candidate: unknown): ParticipantLifecycleEntry | undefined {
    if (!candidate || typeof candidate !== "object") {
      return undefined;
    }

    const entry = candidate as Partial<ParticipantLifecycleEntry>;
    const action = entry.action === "updated" ? "updated" : entry.action === "created" ? "created" : undefined;
    if (!action || !entry.participant || typeof entry.participant !== "object" || typeof entry.participant.id !== "string") {
      return undefined;
    }

    const participant = this.cloneParticipant(entry.participant as Participant);
    const current = this.participants.get(participant.id)?.participant;
    const snapshot = current ? this.cloneParticipant(current) : participant;

    return {
      offset: 0,
      action,
      participantId: snapshot.id,
      role: snapshot.role,
      occurredAt: typeof entry.occurredAt === "number" ? entry.occurredAt : 0,
      participant: snapshot,
    };
  }

  private async persistToDisk(): Promise<void> {
    const participants = this.listRecords().map((record) => this.cloneParticipantRecord(record));
    const lifecycle = this.lifecycle.map((entry, offset) => ({
      ...this.cloneLifecycleEntry(entry),
      offset,
    }));
    this.lifecycle = lifecycle;

    const state: StoredParticipantState = {
      version: 1,
      participants,
      lifecycle,
    };

    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
    await rename(tempPath, this.filePath);
  }

  private listRecords(): StoredParticipantRecord[] {
    return [...this.participants.values()].sort((left, right) => {
      if (left.order === right.order) {
        return left.participant.id.localeCompare(right.participant.id);
      }

      return left.order - right.order;
    });
  }

  private matchesFilter(participant: Participant, filter?: ParticipantQueryFilter): boolean {
    if (!filter) {
      return true;
    }
    if (filter.id && participant.id !== filter.id) {
      return false;
    }
    if (filter.role && participant.role !== filter.role) {
      return false;
    }
    if (filter.skill && !participant.skills.includes(filter.skill)) {
      return false;
    }
    if (filter.identityLevel && participant.identityLevel !== filter.identityLevel) {
      return false;
    }

    return true;
  }

  private appendLifecycle(action: ParticipantLifecycleAction, record: StoredParticipantRecord): void {
    this.lifecycle.push({
      offset: this.lifecycle.length,
      action,
      participantId: record.participant.id,
      role: record.participant.role,
      occurredAt: Date.now(),
      participant: this.cloneParticipant(record.participant),
    });
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

  private recordCursor(record: StoredParticipantRecord): DeterministicCursorPayload {
    return {
      position: record.order,
      id: record.participant.id,
    };
  }

  private lifecycleCursor(entry: ParticipantLifecycleEntry): DeterministicCursorPayload {
    return {
      position: entry.offset,
      id: entry.participantId,
    };
  }

  private cloneParticipantRecord(record: StoredParticipantRecord): StoredParticipantRecord {
    return {
      order: record.order,
      participant: this.cloneParticipant(record.participant),
    };
  }

  private cloneParticipant(participant: Participant): Participant {
    return structuredClone(participant);
  }

  private cloneLifecycleEntry(entry: ParticipantLifecycleEntry): ParticipantLifecycleEntry {
    return {
      ...entry,
      participant: this.cloneParticipant(entry.participant),
    };
  }
}
