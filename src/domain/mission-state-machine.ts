import { MissionStateTransitionError } from "./errors";
import type { MissionEnvelope, MissionStatus } from "./types";

const allowedTransitions: Record<MissionStatus, MissionStatus[]> = {
  Draft: ["Open", "Cancelled"],
  Open: ["Claimed", "Cancelled"],
  Claimed: ["InProgress", "Open", "Cancelled"],
  InProgress: ["UnderReview", "Failed", "Cancelled"],
  UnderReview: ["Settled", "Failed", "InProgress"],
  Settled: [],
  Failed: ["Open", "Cancelled"],
  Cancelled: [],
};

export class MissionStateMachine {
  canTransition(from: MissionStatus, to: MissionStatus): boolean {
    return allowedTransitions[from].includes(to);
  }

  transition(mission: MissionEnvelope, to: MissionStatus): MissionEnvelope {
    if (mission.status === to) {
      return mission;
    }

    if (!this.canTransition(mission.status, to)) {
      throw new MissionStateTransitionError(mission.status, to);
    }

    return {
      ...mission,
      status: to,
      updatedAt: Date.now(),
    };
  }
}
