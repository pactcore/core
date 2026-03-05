import type {
  AntiSpamActionRecord,
  AntiSpamParticipantState,
  AntiSpamRateLimitStore,
} from "../../application/contracts";
import type { AntiSpamAction } from "../../domain/anti-spam";

interface MutableParticipantState {
  firstSeenAt?: number;
  totalStakeCents: number;
  actions: AntiSpamActionRecord[];
}

export class InMemoryAntiSpamRateLimitStore implements AntiSpamRateLimitStore {
  private readonly stateByParticipant = new Map<string, MutableParticipantState>();

  async getParticipantState(participantId: string): Promise<AntiSpamParticipantState> {
    const state = this.ensureState(participantId);
    return {
      participantId,
      firstSeenAt: state.firstSeenAt,
      totalStakeCents: state.totalStakeCents,
      actions: state.actions.slice(),
    };
  }

  async listParticipantActions(
    participantId: string,
    action?: AntiSpamAction,
  ): Promise<AntiSpamActionRecord[]> {
    const state = this.ensureState(participantId);
    if (!action) {
      return state.actions.slice();
    }
    return state.actions.filter((record) => record.action === action);
  }

  async recordAction(record: AntiSpamActionRecord): Promise<void> {
    const state = this.ensureState(record.participantId);
    if (state.firstSeenAt === undefined || record.occurredAt < state.firstSeenAt) {
      state.firstSeenAt = record.occurredAt;
    }
    state.totalStakeCents += Math.max(0, Math.floor(record.stakeCents));
    state.actions.push({
      participantId: record.participantId,
      action: record.action,
      occurredAt: record.occurredAt,
      stakeCents: Math.max(0, Math.floor(record.stakeCents)),
    });
  }

  private ensureState(participantId: string): MutableParticipantState {
    const existing = this.stateByParticipant.get(participantId);
    if (existing) {
      return existing;
    }

    const created: MutableParticipantState = {
      totalStakeCents: 0,
      actions: [],
    };
    this.stateByParticipant.set(participantId, created);
    return created;
  }
}
