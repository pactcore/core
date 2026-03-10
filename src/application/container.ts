import type { EventJournal, ZKProver, ZKVerifier } from "./contracts";
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
import { FileBackedParticipantRepository } from "../infrastructure/repositories/file-backed-participant-repository";
import { FileBackedTaskRepository } from "../infrastructure/repositories/file-backed-task-repository";
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
import { createDefaultSettlementConnectorsFromEnv } from "../infrastructure/settlement/default-settlement-connectors";
import { InMemoryComputeProviderRegistry } from "../infrastructure/compute/in-memory-compute-provider-registry";
import { InMemoryResourceMeter } from "../infrastructure/compute/in-memory-resource-meter";
import { InMemoryComputeExecutionAdapter } from "../infrastructure/compute/in-memory-compute-execution-adapter";
import { InMemoryComputeExecutionCheckpointStore } from "../infrastructure/compute/in-memory-compute-execution-checkpoint-store";
import { PricingEngine } from "../infrastructure/compute/pricing-engine";
import { defaultPricingTable } from "../domain/compute-pricing";
import { InMemoryDIDRepository } from "../infrastructure/identity/in-memory-did-repository";
import { InMemoryCredentialIssuer } from "../infrastructure/identity/in-memory-credential-issuer";
import { InMemoryCredentialRepository } from "../infrastructure/identity/in-memory-credential-repository";
import { InMemoryParticipantStatsRepository } from "../infrastructure/identity/in-memory-participant-stats-repository";
import { InMemoryZKProver } from "../infrastructure/zk/in-memory-zk-prover";
import { InMemoryZKVerifier } from "../infrastructure/zk/in-memory-zk-verifier";
import { InMemoryZKProofRepository } from "../infrastructure/zk/in-memory-zk-proof-repository";
import { InMemoryZKArtifactManifestRepository } from "../infrastructure/zk/in-memory-zk-artifact-manifest-repository";
import { InMemoryZKVerificationReceiptRepository } from "../infrastructure/zk/in-memory-zk-verification-receipt-repository";
import { DeterministicLocalZKProverAdapter } from "../infrastructure/zk/deterministic-local-zk-prover-adapter";
import { RemoteHttpZKProverAdapter } from "../infrastructure/zk/remote-http-zk-prover-adapter";
import { RemoteHttpZKProverAdapterSkeleton } from "../infrastructure/zk/remote-http-zk-prover-adapter-skeleton";
import { loadRemoteZKProverAdapterOptionsFromEnv } from "../infrastructure/zk/remote-zk-prover-config";
import { isRemoteZKProverAdapterConfigured } from "../infrastructure/zk/remote-zk-prover-options";
import { ProductionZKProverBridge } from "../infrastructure/zk/production-zk-prover-bridge";
import { createDefaultZKArtifactManifests } from "../infrastructure/zk/default-zk-artifact-manifest-factory";
import { InMemoryProvenanceGraph } from "../infrastructure/data/in-memory-provenance-graph";
import { InMemoryIntegrityProofRepository } from "../infrastructure/data/in-memory-integrity-proof-repository";
import { InMemoryDataAccessPolicyRepository } from "../infrastructure/data/in-memory-data-access-policy-repository";
import { InMemoryDataAssetRepository } from "../infrastructure/data/in-memory-data-asset-repository";
import { FileBackedDataAssetMetadataStore } from "../infrastructure/data/file-backed-data-asset-metadata-store";
import { InMemoryDataListingRepository } from "../infrastructure/data/in-memory-data-listing-repository";
import { InMemoryDataPurchaseRepository } from "../infrastructure/data/in-memory-data-purchase-repository";
import { InMemoryPolicyRegistry } from "../infrastructure/governance/in-memory-policy-registry";
import { InMemoryTemplateRepository } from "../infrastructure/governance/in-memory-template-repository";
import { InMemoryPluginPackageRepository } from "../infrastructure/dev/in-memory-plugin-package-repository";
import { InMemoryPluginListingRepository } from "../infrastructure/dev/in-memory-plugin-listing-repository";
import { InMemoryPluginInstallRepository } from "../infrastructure/dev/in-memory-plugin-install-repository";
import { InMemoryPluginRevenueShareRepository } from "../infrastructure/dev/in-memory-plugin-revenue-share-repository";
import { InMemoryAntiSpamRateLimitStore } from "../infrastructure/anti-spam/in-memory-anti-spam-rate-limit-store";
import { createManagedBackendInventoryFromEnv } from "../infrastructure/managed/default-managed-backends";
import { MockEvmGovernanceBridge } from "../domain/governance-bridge";
import { MockEvmRewardsBridge } from "../domain/rewards-bridge";
import { PactOrchestrator } from "./orchestrator";
import type { ManagedBackendInventory } from "./managed-backends";
import { PactAntiSpam } from "./modules/pact-anti-spam";
import { PactCompute } from "./modules/pact-compute";
import { PactData } from "./modules/pact-data";
import { PactDev } from "./modules/pact-dev";
import { PactOnchain } from "./modules/pact-onchain";
import { PactPluginMarketplace } from "./modules/pact-plugin-marketplace";
import { PactEconomics } from "./modules/pact-economics";
import { PactHeartbeat } from "./modules/pact-heartbeat";
import { PactID } from "./modules/pact-id";
import { PactMissions } from "./modules/pact-missions";
import { PactDisputes } from "./modules/pact-disputes";
import { PactPay } from "./modules/pact-pay";
import { PactReconciliation } from "./modules/pact-reconciliation";
import { PactSecurity } from "./modules/pact-security";
import { PactTasks } from "./modules/pact-tasks";
import { PactZK } from "./modules/pact-zk";
import { PactReputation } from "./modules/pact-reputation";
import { PactAnalytics } from "./modules/pact-analytics";
import { PactEcosystem } from "./modules/pact-ecosystem";
import type { SettlementConnectorTransport } from "./settlement-connectors";
import { OnchainFinalityRuntime, type OnchainFinalityProvider } from "../domain/onchain-finality";
import type { RpcProvider } from "../infrastructure/blockchain/mock-rpc-provider";
import type { TransactionSigner } from "../blockchain/providers";

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
  pactOnchain: PactOnchain;
  pactPluginMarketplace: PactPluginMarketplace;
  pactMissions: PactMissions;
  pactDisputes: PactDisputes;
  pactHeartbeat: PactHeartbeat;
  pactEconomics: PactEconomics;
  pactReconciliation: PactReconciliation;
  pactEcosystem: PactEcosystem;
  eventJournal: EventJournal;
  agentMailbox: InMemoryAgentMailbox;
}

export interface PactContainerEnvironment {
  PACT_DB_FILE?: string;
  PACT_TASK_STORE_FILE?: string;
  PACT_PARTICIPANT_STORE_FILE?: string;
  PACT_MISSION_STORE_FILE?: string;
  PACT_SETTLEMENT_RECORD_STORE_FILE?: string;
  PACT_EVENT_JOURNAL_STORE_FILE?: string;
  PACT_DATA_ASSET_STORE_FILE?: string;
  PACT_CHALLENGE_MIN_STAKE_CENTS?: string;
  PACT_CHALLENGE_PENALTY_BPS?: string;
  PACT_CHALLENGE_JURY_SHARE_BPS?: string;
  PACT_CHALLENGE_PROTOCOL_TREASURY_ID?: string;
  PACT_CHALLENGE_STAKE_ESCROW_ID?: string;
  PACT_CHALLENGE_STAKE_ASSET_ID?: string;
  PACT_CHALLENGE_STAKE_UNIT?: string;
  PACT_ZK_SECRET?: string;
  PACT_ZK_PROVER_MODE?: string;
  PACT_ZK_RUNTIME_VERSION?: string;
  PACT_ZK_MANIFEST_VERSION?: string;
  PACT_ZK_ADAPTER_NAME?: string;
  PACT_ZK_REMOTE_ENDPOINT?: string;
  PACT_ZK_REMOTE_PROFILE_JSON?: string;
  PACT_ZK_REMOTE_PROVIDER_ID?: string;
  PACT_ZK_REMOTE_CREDENTIAL_TYPE?: string;
  PACT_ZK_REMOTE_REQUIRED_CREDENTIAL_FIELDS_JSON?: string;
  PACT_ZK_REMOTE_TIMEOUT_MS?: string;
  PACT_ZK_REMOTE_API_KEY?: string;
  [key: `PACT_ZK_REMOTE_CREDENTIAL_${string}`]: string | undefined;
  PACT_EVM_RPC_URL?: string;
  PACT_IDENTITY_SBT_ADDRESS?: string;
  PACT_EVM_PRIVATE_KEY?: string;
  PACT_GOVERNANCE_CONTRACT_ADDRESS?: string;
  PACT_REWARDS_CONTRACT_ADDRESS?: string;
  PACT_ONCHAIN_CONFIRMATION_DEPTH?: string;
  PACT_ONCHAIN_FINALITY_DEPTH?: string;
  PACT_LLM_SETTLEMENT_PROFILE_JSON?: string;
  PACT_LLM_SETTLEMENT_PROFILE_ID?: string;
  PACT_LLM_SETTLEMENT_PROVIDER_ID?: string;
  PACT_LLM_SETTLEMENT_DISPLAY_NAME?: string;
  PACT_LLM_SETTLEMENT_ENDPOINT?: string;
  PACT_LLM_SETTLEMENT_TIMEOUT_MS?: string;
  PACT_LLM_SETTLEMENT_CREDENTIAL_TYPE?: string;
  PACT_LLM_SETTLEMENT_CREDENTIAL_FIELDS_JSON?: string;
  PACT_CLOUD_SETTLEMENT_PROFILE_JSON?: string;
  PACT_CLOUD_SETTLEMENT_PROFILE_ID?: string;
  PACT_CLOUD_SETTLEMENT_PROVIDER_ID?: string;
  PACT_CLOUD_SETTLEMENT_DISPLAY_NAME?: string;
  PACT_CLOUD_SETTLEMENT_ENDPOINT?: string;
  PACT_CLOUD_SETTLEMENT_TIMEOUT_MS?: string;
  PACT_CLOUD_SETTLEMENT_CREDENTIAL_TYPE?: string;
  PACT_CLOUD_SETTLEMENT_CREDENTIAL_FIELDS_JSON?: string;
  PACT_API_SETTLEMENT_PROFILE_JSON?: string;
  PACT_API_SETTLEMENT_PROFILE_ID?: string;
  PACT_API_SETTLEMENT_PROVIDER_ID?: string;
  PACT_API_SETTLEMENT_DISPLAY_NAME?: string;
  PACT_API_SETTLEMENT_ENDPOINT?: string;
  PACT_API_SETTLEMENT_TIMEOUT_MS?: string;
  PACT_API_SETTLEMENT_CREDENTIAL_TYPE?: string;
  PACT_API_SETTLEMENT_CREDENTIAL_FIELDS_JSON?: string;
  [key: `PACT_LLM_SETTLEMENT_CREDENTIAL_${string}`]: string | undefined;
  [key: `PACT_LLM_SETTLEMENT_METADATA_${string}`]: string | undefined;
  [key: `PACT_CLOUD_SETTLEMENT_CREDENTIAL_${string}`]: string | undefined;
  [key: `PACT_CLOUD_SETTLEMENT_METADATA_${string}`]: string | undefined;
  [key: `PACT_API_SETTLEMENT_CREDENTIAL_${string}`]: string | undefined;
  [key: `PACT_API_SETTLEMENT_METADATA_${string}`]: string | undefined;
  [key: `PACT_${string}_BACKEND_${string}`]: string | undefined;
}

export interface CreateContainerOptions {
  env?: PactContainerEnvironment;
  managedBackends?: ManagedBackendInventory;
  settlementTransport?: SettlementConnectorTransport;
  onchainFinalityProvider?: OnchainFinalityProvider;
  onchainRpcProvider?: RpcProvider;
  onchainSigner?: TransactionSigner;
  zkRemoteFetch?: typeof fetch;
}

export function createContainer(
  config: ValidationConfig = recommendedValidationConfig,
  options: CreateContainerOptions = {},
): PactContainer {
  const env = options.env ?? process.env;
  const managedBackends = mergeManagedBackendInventory(
    createManagedBackendInventoryFromEnv(env as Record<string, string | undefined>),
    options.managedBackends,
  );
  const dbFile = env.PACT_DB_FILE;
  const taskStoreFile = env.PACT_TASK_STORE_FILE;
  const participantStoreFile = env.PACT_PARTICIPANT_STORE_FILE;

  const taskRepository = taskStoreFile
    ? new FileBackedTaskRepository({ filePath: taskStoreFile })
    : dbFile
      ? new SQLiteTaskRepository({ filePath: dbFile })
      : new InMemoryTaskRepository();
  const missionStoreFile = env.PACT_MISSION_STORE_FILE;
  const dataAssetStoreFile = env.PACT_DATA_ASSET_STORE_FILE;
  const missionRepository = missionStoreFile
    ? new FileBackedMissionRepository({
        filePath: missionStoreFile,
      })
    : new InMemoryMissionRepository();
  const disputeRepository = new InMemoryDisputeRepository();
  const workerRepository = new InMemoryWorkerRepository();
  const participantRepository = participantStoreFile
    ? new FileBackedParticipantRepository({ filePath: participantStoreFile })
    : dbFile
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
  const checkpointStore = new InMemoryComputeExecutionCheckpointStore();
  const pricingEngine = new PricingEngine(defaultPricingTable);
  const didRepository = new InMemoryDIDRepository();
  const credentialIssuer = new InMemoryCredentialIssuer();
  const credentialRepository = new InMemoryCredentialRepository();
  const participantStatsRepository = new InMemoryParticipantStatsRepository();
  const zkSecret = env.PACT_ZK_SECRET ?? "pact-zk-test-secret";
  const zkRuntimeVersion = env.PACT_ZK_RUNTIME_VERSION ?? "0.2.0";
  const zkManifestVersion = env.PACT_ZK_MANIFEST_VERSION ?? "1.0.0";
  const zkAdapterName = env.PACT_ZK_ADAPTER_NAME;
  const zkProverMode = env.PACT_ZK_PROVER_MODE ?? "memory";
  let zkProver: ZKProver = new InMemoryZKProver(zkSecret);
  let zkVerifier: ZKVerifier = new InMemoryZKVerifier(zkSecret);
  const zkProofRepository = new InMemoryZKProofRepository();
  const zkVerificationReceiptRepository = new InMemoryZKVerificationReceiptRepository();
  if (zkProverMode === "bridge-local" || zkProverMode === "bridge-remote") {
    const manifestRepository = new InMemoryZKArtifactManifestRepository();
    for (const manifest of createDefaultZKArtifactManifests(undefined, {
      manifestVersion: zkManifestVersion,
      runtimeVersion: zkRuntimeVersion,
    })) {
      void manifestRepository.save(manifest);
    }

    const remoteAdapterOptions = loadRemoteZKProverAdapterOptionsFromEnv(env as Record<string, string | undefined>);
    const adapter = zkProverMode === "bridge-remote"
      ? isRemoteZKProverAdapterConfigured(remoteAdapterOptions)
        ? new RemoteHttpZKProverAdapter({
            adapterName: zkAdapterName,
            fetchImpl: options.zkRemoteFetch,
            ...remoteAdapterOptions,
          })
        : new RemoteHttpZKProverAdapterSkeleton({
            adapterName: zkAdapterName,
            ...remoteAdapterOptions,
          })
      : new DeterministicLocalZKProverAdapter({
          adapterName: zkAdapterName,
        });

    const bridge = new ProductionZKProverBridge(adapter, manifestRepository, {
      runtimeVersion: zkRuntimeVersion,
      adapterName: zkAdapterName,
    });
    zkProver = bridge;
    zkVerifier = bridge;
  }
  const provenanceGraph = new InMemoryProvenanceGraph();
  const integrityProofRepository = new InMemoryIntegrityProofRepository();
  const dataAccessPolicyRepository = new InMemoryDataAccessPolicyRepository();
  const dataAssetRepository = dataAssetStoreFile
    ? new FileBackedDataAssetMetadataStore({ filePath: dataAssetStoreFile })
    : new InMemoryDataAssetRepository();
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
    checkpointStore,
    managedBackends.compute,
  );
  const pactZK = new PactZK(zkProver, zkVerifier, zkProofRepository, zkVerificationReceiptRepository);
  const pactData = new PactData(
    dataAssetRepository,
    provenanceGraph,
    integrityProofRepository,
    dataAccessPolicyRepository,
    dataListingRepository,
    dataPurchaseRepository,
    managedBackends.data,
  );
  const pactDev = new PactDev(policyRegistry, templateRepository, {
    runtimeVersion: "0.2.0",
  }, managedBackends.dev);
  const governanceBridge = env.PACT_EVM_RPC_URL || options.onchainRpcProvider
    ? new MockEvmGovernanceBridge({
        rpcUrl: env.PACT_EVM_RPC_URL,
        rpcProvider: options.onchainRpcProvider,
        signerPrivateKey: env.PACT_EVM_PRIVATE_KEY,
        signer: options.onchainSigner,
        contractAddress: env.PACT_GOVERNANCE_CONTRACT_ADDRESS,
      })
    : undefined;
  const rewardsBridge = env.PACT_EVM_RPC_URL || options.onchainRpcProvider
    ? new MockEvmRewardsBridge({
        rpcUrl: env.PACT_EVM_RPC_URL,
        rpcProvider: options.onchainRpcProvider,
        signerPrivateKey: env.PACT_EVM_PRIVATE_KEY,
        signer: options.onchainSigner,
        contractAddress: env.PACT_REWARDS_CONTRACT_ADDRESS,
      })
    : undefined;
  const pactOnchain = new PactOnchain(
    governanceBridge,
    rewardsBridge,
    options.onchainFinalityProvider ?? new OnchainFinalityRuntime({
      confirmationDepth: parseIntegerEnv(env.PACT_ONCHAIN_CONFIRMATION_DEPTH, 2),
      finalityDepth: parseIntegerEnv(env.PACT_ONCHAIN_FINALITY_DEPTH, 6),
    }),
  );
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
    settlementConnectors: createDefaultSettlementConnectorsFromEnv(env as Record<string, string | undefined>, {
      transport: options.settlementTransport,
    }),
  });
  const pactReconciliation = new PactReconciliation({ pactEconomics });
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
  const pactEcosystem = new PactEcosystem({
    pactTasks,
    pactPay,
    pactID,
    pactData,
    pactCompute,
    pactDev,
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
    pactOnchain,
    pactPluginMarketplace,
    pactMissions,
    pactDisputes,
    pactHeartbeat,
    pactEconomics,
    pactReconciliation,
    pactEcosystem,
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

function mergeManagedBackendInventory(
  envInventory: ManagedBackendInventory,
  overrides?: ManagedBackendInventory,
): ManagedBackendInventory {
  return {
    data: {
      ...(envInventory.data ?? {}),
      ...(overrides?.data ?? {}),
    },
    compute: {
      ...(envInventory.compute ?? {}),
      ...(overrides?.compute ?? {}),
    },
    dev: {
      ...(envInventory.dev ?? {}),
      ...(overrides?.dev ?? {}),
    },
  };
}
