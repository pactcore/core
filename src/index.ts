export { createApp } from "./api/app";
export { createContainer } from "./application/container";
export type { ContractAddresses } from "./blockchain/contract-abis";
export {
  PACT_ESCROW_ABI,
  PACT_IDENTITY_SBT_ABI,
  PACT_STAKING_ABI,
  PACT_PAY_ROUTER_ABI,
} from "./blockchain/contract-abis";
export {
  functionSelector,
  functionSelectorFromSignature,
  encodeFunction,
  decodeFunctionResult,
  encodeValueWord,
  keccak256Hex,
  type AbiType,
} from "./blockchain/abi-encoder";
export {
  EvmBlockchainGateway,
  EvmIdentitySBTContractClient,
  MockRpcProvider,
} from "./blockchain/evm-gateway";
export { MockRpcProvider as InfrastructureMockRpcProvider } from "./infrastructure/blockchain/mock-rpc-provider";
export { TaskStateMachine } from "./domain/task-state-machine";
export { MissionStateMachine } from "./domain/mission-state-machine";
export {
  postChallengeStake,
  settleChallengeStakeUpheld,
  settleChallengeStakeRejected,
  calculateChallengePenalty,
  splitForfeitedChallengeStake,
} from "./domain/challenge-stake";
export type {
  DisputeCase,
  DisputeConfig,
  DisputeEvidence,
  DisputeStatus,
  DisputeVerdict,
  JuryVote,
} from "./domain/dispute-resolution";
export { ThreeLayerValidationPipeline } from "./domain/validation-pipeline";
export { ReputationModel } from "./domain/reputation";
export {
  calculateOverallScore,
  applyTimeDecay,
  determineReputationLevel,
  clampReputationScore,
  createDefaultDimensions,
  reputationCategories,
  type ReputationCategory,
  type ReputationDimension,
  type ReputationProfile,
  type ReputationEvent,
  type ReputationLevel,
} from "./domain/reputation-multi";
export { GaleShapleyMatcher } from "./domain/matching";
export {
  FirstPriceAuction,
  VickreyAuction,
  type AuctionBid,
  type AuctionResult,
  type AuctionMechanism,
} from "./domain/auction";
export {
  CollusionDetector,
  calculateCollusionCost,
  type CollusionSignal,
  type CollusionCostAnalysis,
  type CollusionDetectorConfig,
} from "./domain/collusion-detection";
export {
  MultiDimensionalMatcher,
  DEFAULT_MATCH_WEIGHTS,
  type MatchScore,
  type MatchWeights,
} from "./domain/multi-dimensional-matching";
export { PaymentSplitService } from "./domain/payment-split";
export type {
  PaymentRoute,
  MicropaymentBatch,
  MicropaymentBatchEntry,
  CreditLine,
  GasSponsorshipGrant,
} from "./domain/payment-routing";
export { CapabilityPolicyEngine, recommendedCapabilityPolicy } from "./domain/capability-policy";
export {
  DEFAULT_LEVEL_CONFIG,
  determineLevel,
  getLevelBenefits,
  type IdentityLevel,
  type IdentityLevelBenefits,
  type IdentityLevelRequirements,
} from "./domain/identity-levels";
export type {
  ZKProofType,
  ZKProofRequest,
  ZKProof,
  ZKLocationClaim,
  ZKCompletionClaim,
  ZKIdentityClaim,
  ZKReputationClaim,
} from "./domain/zk-proofs";
export {
  validateCompensationModel,
  groupCompensationByAsset,
  type CompensationAsset,
  type CompensationModel,
  type CompensationLeg,
} from "./domain/economics";
export {
  DEFAULT_SPAM_SCORE_MODEL,
  DEFAULT_STAKE_REQUIREMENTS,
  DEFAULT_RATE_LIMITS,
  calculateSpamScore,
  getStakeRequirement,
  type AntiSpamAction,
  type StakeRequirement,
  type SpamScoreModel,
  type RateLimitPolicy,
  type ParticipantSpamStats,
} from "./domain/anti-spam";
export { PactMissions } from "./application/modules/pact-missions";
export { PactDisputes } from "./application/modules/pact-disputes";
export { PactHeartbeat } from "./application/modules/pact-heartbeat";
export { PactEconomics } from "./application/modules/pact-economics";
export { PactAntiSpam } from "./application/modules/pact-anti-spam";
export type {
  SettlementConnectorRequest,
  SettlementConnectorResult,
  LlmTokenMeteringConnector,
  CloudCreditBillingConnector,
  ApiQuotaAllocationConnector,
  SettlementConnectors,
} from "./application/settlement-connectors";
export type {
  SettlementRecord,
  SettlementRecordPage,
  SettlementRecordQueryFilter,
  SettlementRecordReplayPage,
  SettlementRecordRepository,
} from "./application/settlement-records";
export type {
  PaymentRouter,
  MicropaymentAggregator,
  CreditLineManager,
  GasSponsorshipManager,
  IdentitySBTContractClient,
  OnchainIdentityRecord,
} from "./application/contracts";
export { InMemoryHeartbeatSupervisor } from "./infrastructure/heartbeat/in-memory-heartbeat-supervisor";
export { FileBackedEventJournal } from "./infrastructure/event-bus/file-backed-event-journal";
export { SQLiteEventJournal } from "./infrastructure/event-bus/sqlite-event-journal";
export { InMemoryPaymentRouter } from "./infrastructure/payment/in-memory-payment-router";
export { InMemoryMicropaymentAggregator } from "./infrastructure/payment/in-memory-micropayment-aggregator";
export { InMemoryCreditLineManager } from "./infrastructure/payment/in-memory-credit-line-manager";
export { InMemoryGasSponsorshipManager } from "./infrastructure/payment/in-memory-gas-sponsorship-manager";
export { InMemoryLlmTokenMeteringConnector } from "./infrastructure/settlement/in-memory-llm-token-metering-connector";
export { InMemoryCloudCreditBillingConnector } from "./infrastructure/settlement/in-memory-cloud-credit-billing-connector";
export { InMemoryApiQuotaAllocationConnector } from "./infrastructure/settlement/in-memory-api-quota-allocation-connector";
export { InMemoryDurableSettlementRecordRepository } from "./infrastructure/repositories/in-memory-durable-settlement-record-repository";
export { FileBackedDurableSettlementRecordRepository } from "./infrastructure/repositories/file-backed-durable-settlement-record-repository";
export { FileBackedMissionRepository } from "./infrastructure/repositories/file-backed-mission-repository";
export { InMemoryDisputeRepository } from "./infrastructure/repositories/in-memory-dispute-repository";
export { SQLiteTaskRepository } from "./infrastructure/repositories/sqlite-task-repository";
export { SQLiteParticipantRepository } from "./infrastructure/repositories/sqlite-participant-repository";
export { SQLiteReputationRepository } from "./infrastructure/repositories/sqlite-reputation-repository";
export { InMemoryReputationProfileRepository } from "./infrastructure/reputation/in-memory-reputation-profile-repository";
export { InMemoryReputationEventRepository } from "./infrastructure/reputation/in-memory-reputation-event-repository";
export { InMemoryAntiSpamRateLimitStore } from "./infrastructure/anti-spam/in-memory-anti-spam-rate-limit-store";

// PactCompute infrastructure
export { InMemoryComputeProviderRegistry } from "./infrastructure/compute/in-memory-compute-provider-registry";
export { InMemoryResourceMeter } from "./infrastructure/compute/in-memory-resource-meter";
export { InMemoryComputeExecutionAdapter } from "./infrastructure/compute/in-memory-compute-execution-adapter";
export { DockerExecutionAdapter } from "./infrastructure/compute/docker-execution-adapter";
export { PricingEngine } from "./infrastructure/compute/pricing-engine";
export {
  calculateJobCost,
  findBestTier,
  defaultPricingTable,
  type PricingTable,
  type ResourceTier,
} from "./domain/compute-pricing";

// PactID / DID infrastructure
export { InMemoryDIDRepository } from "./infrastructure/identity/in-memory-did-repository";
export { InMemoryCredentialIssuer } from "./infrastructure/identity/in-memory-credential-issuer";
export { InMemoryCredentialRepository } from "./infrastructure/identity/in-memory-credential-repository";
export { InMemoryParticipantStatsRepository } from "./infrastructure/identity/in-memory-participant-stats-repository";
export { InMemoryZKProver } from "./infrastructure/zk/in-memory-zk-prover";
export { InMemoryZKVerifier } from "./infrastructure/zk/in-memory-zk-verifier";
export { InMemoryZKProofRepository } from "./infrastructure/zk/in-memory-zk-proof-repository";

// PactData infrastructure
export { InMemoryProvenanceGraph } from "./infrastructure/data/in-memory-provenance-graph";
export { InMemoryIntegrityProofRepository } from "./infrastructure/data/in-memory-integrity-proof-repository";
export { InMemoryDataAccessPolicyRepository } from "./infrastructure/data/in-memory-data-access-policy-repository";
export { InMemoryDataAssetRepository } from "./infrastructure/data/in-memory-data-asset-repository";
export { InMemoryDataListingRepository } from "./infrastructure/data/in-memory-data-listing-repository";
export { InMemoryDataPurchaseRepository } from "./infrastructure/data/in-memory-data-purchase-repository";
export { calculateRevenueDistribution } from "./domain/data-marketplace";
export type {
  DataCategory,
  DataListing,
  DataPurchase,
  RevenueDistribution,
  DataMarketplaceStats,
} from "./domain/data-marketplace";

// PactDev / Governance infrastructure
export { InMemoryPolicyRegistry } from "./infrastructure/governance/in-memory-policy-registry";
export { InMemoryTemplateRepository } from "./infrastructure/governance/in-memory-template-repository";
export { InMemoryPluginPackageRepository } from "./infrastructure/dev/in-memory-plugin-package-repository";
export { InMemoryPluginListingRepository } from "./infrastructure/dev/in-memory-plugin-listing-repository";
export { InMemoryPluginInstallRepository } from "./infrastructure/dev/in-memory-plugin-install-repository";
export { InMemoryPluginRevenueShareRepository } from "./infrastructure/dev/in-memory-plugin-revenue-share-repository";
export { calculateRevenueShare } from "./domain/plugin-marketplace";
export type {
  PluginPackage,
  PluginListing,
  PluginInstall,
  RevenueShare,
} from "./domain/plugin-marketplace";

// Module exports
export { PactCompute } from "./application/modules/pact-compute";
export { PactData } from "./application/modules/pact-data";
export { PactDev } from "./application/modules/pact-dev";
export { PactPluginMarketplace } from "./application/modules/pact-plugin-marketplace";
export { PactID } from "./application/modules/pact-id";
export { PactTasks } from "./application/modules/pact-tasks";
export { PactPay } from "./application/modules/pact-pay";
export { PactZK } from "./application/modules/pact-zk";
export { PactReputation } from "./application/modules/pact-reputation";
