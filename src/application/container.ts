import type { EventJournal } from "./contracts";
import { recommendedValidationConfig, type ValidationConfig } from "../domain/validation-pipeline";
import { TaskStateMachine } from "../domain/task-state-machine";
import { EvmIdentitySBTContractClient } from "../blockchain/evm-gateway";
import { InMemoryBaseChainGateway } from "../infrastructure/blockchain/in-memory-base-chain-gateway";
import { InMemoryAgentMailbox } from "../infrastructure/agent/in-memory-agent-mailbox";
import { FileBackedEventJournal } from "../infrastructure/event-bus/file-backed-event-journal";
import { InMemoryEventBus } from "../infrastructure/event-bus/in-memory-event-bus";
import { InMemoryEventJournal } from "../infrastructure/event-bus/in-memory-event-journal";
import { SQLiteEventJournal } from "../infrastructure/event-bus/sqlite-event-journal";
import { InMemoryX402PaymentAdapter } from "../infrastructure/payment/in-memory-x402-payment-adapter";
import { X402Relayer } from "../infrastructure/payment/x402-relayer";
import { InMemoryHeartbeatSupervisor } from "../infrastructure/heartbeat/in-memory-heartbeat-supervisor";
import { FileBackedMissionRepository } from "../infrastructure/repositories/file-backed-mission-repository";
import { InMemoryDisputeRepository } from "../infrastructure/repositories/in-memory-dispute-repository";
import { InMemoryMissionRepository } from "../infrastructure/repositories/in-memory-mission-repository";
import { InMemoryParticipantRepository } from "../infrastructure/repositories/in-memory-participant-repository";
import { InMemoryReputationRepository } from "../infrastructure/repositories/in-memory-reputation-repository";
import { SQLiteParticipantRepository } from "../infrastructure/repositories/sqlite-participant-repository";
import { SQLiteReputationRepository } from "../infrastructure/repositories/sqlite-reputation-repository";
import { SQLiteTaskRepository } from "../infrastructure/repositories/sqlite-task-repository";
import { FileBackedDurableSettlementRecordRepository } from "../infrastructure/repositories/file-backed-durable-settlement-record-repository";
import { InMemoryDurableSettlementRecordRepository } from "../infrastructure/repositories/in-memory-durable-settlement-record-repository";
import { InMemoryTaskRepository } from "../infrastructure/repositories/in-memory-task-repository";
import { InMemoryWorkerRepository } from "../infrastructure/repositories/in-memory-worker-repository";
import { InMemoryReputationService } from "../infrastructure/reputation/in-memory-reputation-service";
import { InMemoryReputationProfileRepository } from "../infrastructure/reputation/in-memory-reputation-profile-repository";
import { InMemoryReputationEventRepository } from "../infrastructure/reputation/in-memory-reputation-event-repository";
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
import { InMemoryPluginPackageRepository } from "../infrastructure/dev/in-memory-plugin-package-repository";
import { InMemoryPluginListingRepository } from "../infrastructure/dev/in-memory-plugin-listing-repository";
import { InMemoryPluginInstallRepository } from "../infrastructure/dev/in-memory-plugin-install-repository";
import { InMemoryPluginRevenueShareRepository } from "../infrastructure/dev/in-memory-plugin-revenue-share-repository";
import { InMemoryAntiSpamRateLimitStore } from "../infrastructure/anti-spam/in-memory-anti-spam-rate-limit-store";
import { PactOrchestrator } from "./orchestrator";
import { PactAntiSpam } from "./modules/pact-anti-spam";
import { PactCompute } from "./modules/pact-compute";
import { PactData } from "./modules/pact-data";
import { PactDev } from "./modules/pact-dev";
import { PactPluginMarketplace } from "./modules/pact-plugin-marketplace";
import { PactEconomics } from "./modules/pact-economics";
import { PactHeartbeat } from "./modules/pact-heartbeat";
import { PactID } from "./modules/pact-id";
import { PactMissions } from "./modules/pact-missions";
import { PactDisputes } from "./modules/pact-disputes";
import { PactPay } from "./modules/pact-pay";
import { PactSecurity } from "./modules/pact-security";
import { PactTasks } from "./modules/pact-tasks";
import { PactZK } from "./modules/pact-zk";
import { PactReputation } from "./modules/pact-reputation";
import { PactAnalytics } from "./modules/pact-analytics";

export interface PactContainer {
  pactAntiSpam: PactAntiSpam;
  pactCompute: PactCompute;
  pactSecurity: PactSecurity;
  pactTasks: PactTasks;
  pactPay: PactPay;
  pactReputation: PactReputation;
  pactAnalytics: PactAnalytics;
  pactID: PactID;
  pactZK: PactZK;
  pactData: PactData;
  pactDev: PactDev;
  pactPluginMarketplace: PactPluginMarketplace;
  pactMissions: PactMissions;
  pactDisputes: PactDisputes;
  pactHeartbeat: PactHeartbeat;
  pactEconomics: PactEconomics;
  eventJournal: EventJournal;
  agentMailbox: InMemoryAgentMailbox;
}

export interface PactContainerEnvironment {
  PACT_DB_FILE?: string;
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
  PACT_EVM_RPC_URL?: string;
  PACT_IDENTITY_SBT_ADDRESS?: string;
  PACT_EVM_PRIVATE_KEY?: string;
}

export interface CreateContainerOptions {
  env?: PactContainerEnvironment;
}

export function createContainer(
  config: ValidationConfig = recommendedValidationConfig,
  options: CreateContainerOptions = {},
): PactContainer {
  const env = options.env ?? process.env;
  const dbFile = env.PACT_DB_FILE;

  const taskRepository = dbFile
    ? new SQLiteTaskRepository({ filePath: dbFile })
    : new InMemoryTaskRepository();
  const missionStoreFile = env.PACT_MISSION_STORE_FILE;
  const missionRepository = missionStoreFile
    ? new FileBackedMissionRepository({
        filePath: missionStoreFile,
      })
    : new InMemoryMissionRepository();
  const disputeRepository = new InMemoryDisputeRepository();
  const workerRepository = new InMemoryWorkerRepository();
  const participantRepository = dbFile
    ? new SQLiteParticipantRepository({ filePath: dbFile })
    : new InMemoryParticipantRepository();
  const reputationRepository = dbFile
    ? new SQLiteReputationRepository({ filePath: dbFile })
    : new InMemoryReputationRepository();
  const settlementRecordStoreFile = env.PACT_SETTLEMENT_RECORD_STORE_FILE;
  const settlementRecordRepository = settlementRecordStoreFile
    ? new FileBackedDurableSettlementRecordRepository({
        filePath: settlementRecordStoreFile,
      })
    : new InMemoryDurableSettlementRecordRepository();

  const eventJournalStoreFile = env.PACT_EVENT_JOURNAL_STORE_FILE;
  const eventJournal = dbFile
    ? new SQLiteEventJournal({
        filePath: dbFile,
      })
    : eventJournalStoreFile
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
  const reputationProfileRepository = new InMemoryReputationProfileRepository();
  const reputationEventRepository = new InMemoryReputationEventRepository();
  const validatorConsensus = new InMemoryValidatorConsensus(config);
  const blockchain = new InMemoryBaseChainGateway();
  const x402Adapter = new InMemoryX402PaymentAdapter();
  const x402Relayer = new X402Relayer(x402Adapter);

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
  const identitySbtClient =
    env.PACT_EVM_RPC_URL && env.PACT_IDENTITY_SBT_ADDRESS
      ? new EvmIdentitySBTContractClient({
          rpcUrl: env.PACT_EVM_RPC_URL,
          contractAddress: env.PACT_IDENTITY_SBT_ADDRESS,
          signerPrivateKey: env.PACT_EVM_PRIVATE_KEY,
        })
      : undefined;
  const pluginPackageRepository = new InMemoryPluginPackageRepository();
  const pluginListingRepository = new InMemoryPluginListingRepository();
  const pluginInstallRepository = new InMemoryPluginInstallRepository();
  const pluginRevenueShareRepository = new InMemoryPluginRevenueShareRepository();
  const antiSpamRateLimitStore = new InMemoryAntiSpamRateLimitStore();

  const pactPay = new PactPay(blockchain, x402Adapter, "treasury", undefined, undefined, undefined, undefined, x402Relayer);
  const pactReputation = new PactReputation(reputationProfileRepository, reputationEventRepository);
  const pactAntiSpam = new PactAntiSpam({
    rateLimitStore: antiSpamRateLimitStore,
    participantStatsRepository,
    reputationRepository,
    didRepository,
  });
  const pactSecurity = new PactSecurity({
    participantStatsRepository,
    didRepository,
    antiSpamRateLimitStore,
  });
  const pactID = new PactID(
    participantRepository,
    workerRepository,
    reputationService,
    didRepository,
    credentialIssuer,
    credentialRepository,
    participantStatsRepository,
    identitySbtClient,
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
  const pactPluginMarketplace = new PactPluginMarketplace(
    pluginPackageRepository,
    pluginListingRepository,
    pluginInstallRepository,
    pluginRevenueShareRepository,
  );
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
  const pactDisputes = new PactDisputes(
    disputeRepository,
    missionRepository,
    participantRepository,
    reputationRepository,
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
  const pactAnalytics = new PactAnalytics({
    pactAntiSpam,
    pactCompute,
    pactData,
    pactDisputes,
    pactEconomics,
    pactID,
    pactMissions,
    pactPay,
    pactReputation,
    pactTasks,
    eventJournal,
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
    pactAntiSpam,
    pactCompute,
    pactSecurity,
    pactTasks,
    pactPay,
    pactReputation,
    pactAnalytics,
    pactID,
    pactZK,
    pactData,
    pactDev,
    pactPluginMarketplace,
    pactMissions,
    pactDisputes,
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
