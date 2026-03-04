import type { EventJournal } from "./contracts";
import { recommendedValidationConfig, type ValidationConfig } from "../domain/validation-pipeline";
import { TaskStateMachine } from "../domain/task-state-machine";
import { InMemoryBaseChainGateway } from "../infrastructure/blockchain/in-memory-base-chain-gateway";
import { InMemoryAgentMailbox } from "../infrastructure/agent/in-memory-agent-mailbox";
import { FileBackedEventJournal } from "../infrastructure/event-bus/file-backed-event-journal";
import { InMemoryEventBus } from "../infrastructure/event-bus/in-memory-event-bus";
import { InMemoryEventJournal } from "../infrastructure/event-bus/in-memory-event-journal";
import { InMemoryX402PaymentAdapter } from "../infrastructure/payment/in-memory-x402-payment-adapter";
import { InMemoryHeartbeatSupervisor } from "../infrastructure/heartbeat/in-memory-heartbeat-supervisor";
import { FileBackedMissionRepository } from "../infrastructure/repositories/file-backed-mission-repository";
import { InMemoryMissionRepository } from "../infrastructure/repositories/in-memory-mission-repository";
import { InMemoryParticipantRepository } from "../infrastructure/repositories/in-memory-participant-repository";
import { InMemoryReputationRepository } from "../infrastructure/repositories/in-memory-reputation-repository";
import { FileBackedDurableSettlementRecordRepository } from "../infrastructure/repositories/file-backed-durable-settlement-record-repository";
import { InMemoryDurableSettlementRecordRepository } from "../infrastructure/repositories/in-memory-durable-settlement-record-repository";
import { InMemoryTaskRepository } from "../infrastructure/repositories/in-memory-task-repository";
import { InMemoryWorkerRepository } from "../infrastructure/repositories/in-memory-worker-repository";
import { InMemoryReputationService } from "../infrastructure/reputation/in-memory-reputation-service";
import { InMemoryScheduler } from "../infrastructure/scheduler/in-memory-scheduler";
import { InMemoryTaskManager } from "../infrastructure/task-manager/in-memory-task-manager";
import { InMemoryValidatorConsensus } from "../infrastructure/validator-consensus/in-memory-validator-consensus";
import { InMemoryApiQuotaAllocationConnector } from "../infrastructure/settlement/in-memory-api-quota-allocation-connector";
import { InMemoryCloudCreditBillingConnector } from "../infrastructure/settlement/in-memory-cloud-credit-billing-connector";
import { InMemoryLlmTokenMeteringConnector } from "../infrastructure/settlement/in-memory-llm-token-metering-connector";
import { PactOrchestrator } from "./orchestrator";
import { PactCompute } from "./modules/pact-compute";
import { PactData } from "./modules/pact-data";
import { PactDev } from "./modules/pact-dev";
import { PactEconomics } from "./modules/pact-economics";
import { PactHeartbeat } from "./modules/pact-heartbeat";
import { PactID } from "./modules/pact-id";
import { PactMissions } from "./modules/pact-missions";
import { PactPay } from "./modules/pact-pay";
import { PactTasks } from "./modules/pact-tasks";

export interface PactContainer {
  pactCompute: PactCompute;
  pactTasks: PactTasks;
  pactPay: PactPay;
  pactID: PactID;
  pactData: PactData;
  pactDev: PactDev;
  pactMissions: PactMissions;
  pactHeartbeat: PactHeartbeat;
  pactEconomics: PactEconomics;
  eventJournal: EventJournal;
  agentMailbox: InMemoryAgentMailbox;
}

export interface PactContainerEnvironment {
  PACT_MISSION_STORE_FILE?: string;
  PACT_SETTLEMENT_RECORD_STORE_FILE?: string;
  PACT_EVENT_JOURNAL_STORE_FILE?: string;
}

export interface CreateContainerOptions {
  env?: PactContainerEnvironment;
}

export function createContainer(
  config: ValidationConfig = recommendedValidationConfig,
  options: CreateContainerOptions = {},
): PactContainer {
  const env = options.env ?? process.env;

  const taskRepository = new InMemoryTaskRepository();
  const missionStoreFile = env.PACT_MISSION_STORE_FILE;
  const missionRepository = missionStoreFile
    ? new FileBackedMissionRepository({
        filePath: missionStoreFile,
      })
    : new InMemoryMissionRepository();
  const workerRepository = new InMemoryWorkerRepository();
  const participantRepository = new InMemoryParticipantRepository();
  const reputationRepository = new InMemoryReputationRepository();
  const settlementRecordStoreFile = env.PACT_SETTLEMENT_RECORD_STORE_FILE;
  const settlementRecordRepository = settlementRecordStoreFile
    ? new FileBackedDurableSettlementRecordRepository({
        filePath: settlementRecordStoreFile,
      })
    : new InMemoryDurableSettlementRecordRepository();

  const eventJournalStoreFile = env.PACT_EVENT_JOURNAL_STORE_FILE;
  const eventJournal = eventJournalStoreFile
    ? new FileBackedEventJournal({
        filePath: eventJournalStoreFile,
      })
    : new InMemoryEventJournal();
  const eventBus = new InMemoryEventBus(eventJournal);
  const agentMailbox = new InMemoryAgentMailbox();

  const stateMachine = new TaskStateMachine();
  const taskManager = new InMemoryTaskManager(taskRepository, stateMachine);

  const scheduler = new InMemoryScheduler();
  const heartbeatSupervisor = new InMemoryHeartbeatSupervisor(scheduler);
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
  const pactMissions = new PactMissions(
    missionRepository,
    participantRepository,
    agentMailbox,
    eventBus,
  );
  const pactHeartbeat = new PactHeartbeat(heartbeatSupervisor, eventBus);
  const pactEconomics = new PactEconomics({
    settlementRecordRepository,
    eventBus,
    settlementConnectors: {
      llmTokenMetering: new InMemoryLlmTokenMeteringConnector(),
      cloudCreditBilling: new InMemoryCloudCreditBillingConnector(),
      apiQuotaAllocation: new InMemoryApiQuotaAllocationConnector(),
    },
  });

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
    pactMissions,
    pactHeartbeat,
    pactEconomics,
    eventJournal,
    agentMailbox,
  };
}
