import { recommendedValidationConfig, type ValidationConfig } from "../domain/validation-pipeline";
import { TaskStateMachine } from "../domain/task-state-machine";
import { InMemoryBaseChainGateway } from "../infrastructure/blockchain/in-memory-base-chain-gateway";
import { InMemoryEventBus } from "../infrastructure/event-bus/in-memory-event-bus";
import { InMemoryX402PaymentAdapter } from "../infrastructure/payment/in-memory-x402-payment-adapter";
import { InMemoryParticipantRepository } from "../infrastructure/repositories/in-memory-participant-repository";
import { InMemoryReputationRepository } from "../infrastructure/repositories/in-memory-reputation-repository";
import { InMemoryTaskRepository } from "../infrastructure/repositories/in-memory-task-repository";
import { InMemoryWorkerRepository } from "../infrastructure/repositories/in-memory-worker-repository";
import { InMemoryReputationService } from "../infrastructure/reputation/in-memory-reputation-service";
import { InMemoryScheduler } from "../infrastructure/scheduler/in-memory-scheduler";
import { InMemoryTaskManager } from "../infrastructure/task-manager/in-memory-task-manager";
import { InMemoryValidatorConsensus } from "../infrastructure/validator-consensus/in-memory-validator-consensus";
import { PactOrchestrator } from "./orchestrator";
import { PactCompute } from "./modules/pact-compute";
import { PactData } from "./modules/pact-data";
import { PactDev } from "./modules/pact-dev";
import { PactID } from "./modules/pact-id";
import { PactPay } from "./modules/pact-pay";
import { PactTasks } from "./modules/pact-tasks";

export interface PactContainer {
  pactCompute: PactCompute;
  pactTasks: PactTasks;
  pactPay: PactPay;
  pactID: PactID;
  pactData: PactData;
  pactDev: PactDev;
}

export function createContainer(config: ValidationConfig = recommendedValidationConfig): PactContainer {
  const taskRepository = new InMemoryTaskRepository();
  const workerRepository = new InMemoryWorkerRepository();
  const participantRepository = new InMemoryParticipantRepository();
  const reputationRepository = new InMemoryReputationRepository();

  const eventBus = new InMemoryEventBus();
  const stateMachine = new TaskStateMachine();
  const taskManager = new InMemoryTaskManager(taskRepository, stateMachine);

  const scheduler = new InMemoryScheduler();
  const reputationService = new InMemoryReputationService(reputationRepository);
  const validatorConsensus = new InMemoryValidatorConsensus(config);
  const blockchain = new InMemoryBaseChainGateway();
  const x402Adapter = new InMemoryX402PaymentAdapter();

  const pactPay = new PactPay(blockchain, x402Adapter);
  const pactID = new PactID(participantRepository, workerRepository, reputationService);
  const pactTasks = new PactTasks(taskManager, workerRepository, eventBus, pactPay);
  const pactCompute = new PactCompute(scheduler);
  const pactData = new PactData();
  const pactDev = new PactDev();

  const orchestrator = new PactOrchestrator(
    eventBus,
    validatorConsensus,
    pactTasks,
    pactPay,
    reputationService,
  );
  orchestrator.register();

  return {
    pactCompute,
    pactTasks,
    pactPay,
    pactID,
    pactData,
    pactDev,
  };
}
