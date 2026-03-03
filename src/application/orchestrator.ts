import type { EventBus, ReputationService, ValidatorConsensus } from "./contracts";
import { DomainEvents } from "./events";
import { PactPay } from "./modules/pact-pay";
import { PactTasks } from "./modules/pact-tasks";
import type { Task } from "../domain/types";

interface TaskEventPayload {
  task: Task;
}

export class PactOrchestrator {
  constructor(
    private readonly eventBus: EventBus,
    private readonly validatorConsensus: ValidatorConsensus,
    private readonly pactTasks: PactTasks,
    private readonly pactPay: PactPay,
    private readonly reputationService: ReputationService,
  ) {}

  register(): void {
    this.eventBus.subscribe<TaskEventPayload>(DomainEvents.TaskSubmitted, async (event) => {
      const task = event.payload.task;
      if (!task.evidence) {
        return;
      }

      const outcome = await this.validatorConsensus.evaluate(task.evidence);
      if (!outcome.passed) {
        await this.reputationService.adjustScore(task.issuerId, "issuer", -1);
        await this.eventBus.publish({
          name: DomainEvents.TaskValidationFailed,
          payload: {
            taskId: task.id,
            reason: outcome.reason,
            steps: outcome.steps,
          },
          createdAt: Date.now(),
        });
        return;
      }

      await this.pactTasks.markVerified(task.id, outcome.validatorIds);
    });

    this.eventBus.subscribe<TaskEventPayload>(DomainEvents.TaskVerified, async (event) => {
      const task = event.payload.task;
      await this.pactPay.settle(task);
      await this.pactTasks.markCompleted(task.id);

      if (task.assigneeId) {
        await this.reputationService.adjustScore(task.assigneeId, "worker", +2);
      }
      for (const validatorId of task.validatorIds) {
        await this.reputationService.adjustScore(validatorId, "validator", +1);
      }
      await this.reputationService.adjustScore(task.issuerId, "issuer", +0.5);
    });
  }
}
