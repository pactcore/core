import { IllegalStateTransitionError } from "./errors";
import type { Task, TaskStatus } from "./types";

const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  Created: ["Assigned"],
  Assigned: ["Submitted"],
  Submitted: ["Verified"],
  Verified: ["Completed"],
  Completed: [],
};

export class TaskStateMachine {
  canTransition(from: TaskStatus, to: TaskStatus): boolean {
    return TRANSITIONS[from].includes(to);
  }

  transition(task: Task, to: TaskStatus): Task {
    if (!this.canTransition(task.status, to)) {
      throw new IllegalStateTransitionError(task.status, to);
    }

    return {
      ...task,
      status: to,
      updatedAt: Date.now(),
    };
  }
}
