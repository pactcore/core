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
import { InMemoryComputeProviderRegistry } from "../infrastructure/compute/in-memory-compute-provider-registry";
import { InMemoryResourceMeter } from "../infrastructure/compute/in-memory-resource-meter";
import { InMemoryComputeExecutionAdapter } from "../infrastructure/compute/in-memory-compute-execution-adapter";
import { PricingEngine } from "../infrastructure/compute/pricing-engine";
import { defaultPricingTable } from "../domain/compute-pricing";
import { InMemoryDIDRepository } from "../infrastructure/identity/in-memory-did-repository";
import { InMemoryCredentialIssuer } from "../infrastructure/identity/in-memory-credential-issuer";
import { InMemoryCredentialRepository } from "../infrastructure/identity/in-memory-credential-repository";
import { InMemoryParticipantStatsRepository } from "../infrastructure/identity/in-memory-participant-stats-repository";
import { InMemoryZKProver } from "../infrastructure/zk/in-memory-zk-prover";
import { InMemoryZKVerifier } from "../infrastructure/zk/in-memory-zk-verifier";
import { InMemoryZKProofRepository } from "../infrastructure/zk/in-memory-zk-proof-repository";
import { InMemoryProvenanceGraph } from "../infrastructure/data/in-memory-provenance-graph";
import { InMemoryIntegrityProofRepository } from "../infrastructure/data/in-memory-integrity-proof-repository";
import { InMemoryDataAccessPolicyRepository } from "../infrastructure/data/in-memory-data-access-policy-repository";
import { InMemoryDataAssetRepository } from "../infrastructure/data/in-memory-data-asset-repository";
import { InMemoryDataListingRepository } from "../infrastructure/data/in-memory-data-listing-repository";
import { InMemoryDataPurchaseRepository } from "../infrastructure/data/in-memory-data-purchase-repository";
import { InMemoryPolicyRegistry } from "../infrastructure/governance/in-memory-policy-registry";
import { InMemoryTemplateRepository } from "../infrastructure/governance/in-memory-template-repository";
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
import { PactZK } from "./modules/pact-zk";

export interface PactContainer {
  pactCompute: PactCompute;
  pactTasks: PactTasks;
  pactPay: PactPay;
  pactID: PactID;
  pactZK: PactZK;
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
  PACT_CHALLENGE_MIN_STAKE_CENTS?: string;
  PACT_CHALLENGE_PENALTY_BPS?: string;
  PACT_CHALLENGE_JURY_SHARE_BPS?: string;
  PACT_CHALLENGE_PROTOCOL_TREASURY_ID?: string;
  PACT_CHALLENGE_STAKE_ESCROW_ID?: string;
  PACT_CHALLENGE_STAKE_ASSET_ID?: string;
  PACT_CHALLENGE_STAKE_UNIT?: string;
  PACT_ZK_SECRET?: string;
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

  const providerRegistry = new InMemoryComputeProviderRegistry();
  const resourceMeter = new InMemoryResourceMeter();
  const executionAdapter = new InMemoryComputeExecutionAdapter();
  const pricingEngine = new PricingEngine(defaultPricingTable);
  const didRepository = new InMemoryDIDRepository();
  const credentialIssuer = new InMemoryCredentialIssuer();
  const credentialRepository = new InMemoryCredentialRepository();
  const participantStatsRepository = new InMemoryParticipantStatsRepository();
  const zkSecret = env.PACT_ZK_SECRET ?? "pact-zk-test-secret";
  const zkProver = new InMemoryZKProver(zkSecret);
  const zkVerifier = new InMemoryZKVerifier(zkSecret);
  const zkProofRepository = new InMemoryZKProofRepository();
  const provenanceGraph = new InMemoryProvenanceGraph();
  const integrityProofRepository = new InMemoryIntegrityProofRepository();
  const dataAccessPolicyRepository = new InMemoryDataAccessPolicyRepository();
  const dataAssetRepository = new InMemoryDataAssetRepository();
  const dataListingRepository = new InMemoryDataListingRepository();
  const dataPurchaseRepository = new InMemoryDataPurchaseRepository();
  const policyRegistry = new InMemoryPolicyRegistry();
  const templateRepository = new InMemoryTemplateRepository();

  const pactPay = new PactPay(blockchain, x402Adapter);
  const pactID = new PactID(
    participantRepository,
    workerRepository,
    reputationService,
    didRepository,
    credentialIssuer,
    credentialRepository,
    participantStatsRepository,
  );
  const pactTasks = new PactTasks(taskManager, workerRepository, eventBus, pactPay);
  const pactCompute = new PactCompute(
    scheduler,
    providerRegistry,
    resourceMeter,
    executionAdapter,
    pricingEngine,
  );
  const pactZK = new PactZK(zkProver, zkVerifier, zkProofRepository);
  const pactData = new PactData(
    dataAssetRepository,
    provenanceGraph,
    integrityProofRepository,
    dataAccessPolicyRepository,
    dataListingRepository,
    dataPurchaseRepository,
  );
  const pactDev = new PactDev(policyRegistry, templateRepository);
  const pactMissions = new PactMissions(
    missionRepository,
    participantRepository,
    agentMailbox,
    eventBus,
    undefined,
    {
      settlementRecordRepository,
      challengeStakePolicy: {
        minimumStakeCents: parseIntegerEnv(env.PACT_CHALLENGE_MIN_STAKE_CENTS, 500),
        penaltyBps: parseIntegerEnv(env.PACT_CHALLENGE_PENALTY_BPS, 2_000),
        juryShareBps: parseIntegerEnv(env.PACT_CHALLENGE_JURY_SHARE_BPS, 7_000),
        protocolTreasuryId: env.PACT_CHALLENGE_PROTOCOL_TREASURY_ID ?? "protocol:treasury",
        stakeEscrowId: env.PACT_CHALLENGE_STAKE_ESCROW_ID ?? "challenge:escrow",
        assetId: env.PACT_CHALLENGE_STAKE_ASSET_ID ?? "USDC",
        unit: env.PACT_CHALLENGE_STAKE_UNIT ?? "USDC_CENTS",
      },
    },
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
    pactZK,
    pactData,
    pactDev,
    pactMissions,
    pactHeartbeat,
    pactEconomics,
    eventJournal,
    agentMailbox,
  };
}

function parseIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`invalid integer environment value: ${value}`);
  }

  return parsed;
}
