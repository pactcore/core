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
  simulateVerificationCost,
  calculateOptimalStrategy,
  type CostAccuracyTradeoff,
  type VerificationStrategy,
} from "./domain/verification-cost-model";
export {
  calculateNashEquilibrium,
  isStableEquilibrium,
  type NashEquilibriumState,
  type PayoffMatrix,
} from "./domain/nash-equilibrium";
export {
  calculateAutonomyLevel,
  assessAgentCapability,
  type AutonomyLevel,
  type AutonomyMetrics,
  type AgentCapabilityHistoryEntry,
} from "./domain/agent-autonomy";
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
  buildThreatModel,
  assessRisk,
  type ThreatCategory,
  type ThreatSeverity,
  type ThreatEntry,
  type SecurityAuditResult,
  type SecurityNetworkStats,
} from "./domain/security-threat-model";
export {
  SybilResistanceScore,
  FrontRunningDetector,
  ReplayAttackPrevention,
  type SybilResistanceInput,
  type TimedTransaction,
  type FrontRunningAlert,
  type FrontRunningDetectorConfig,
  type NonceFailureReason,
  type NonceVerificationResult,
} from "./domain/network-security";
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
export type {
  PactApplication,
  PactToken,
  TokenDistribution,
  VestingSchedule,
  TokenomicsModel,
  TokenSupplyProjection,
} from "./domain/token-economics";
export {
  TOKENOMICS_MODEL,
  calculateCirculatingSupply,
  getDistribution,
  calculateStakingAPY,
  calculateBurnRate,
  projectTokenSupply,
} from "./domain/token-economics";
export type {
  FeeAppType,
  VolumeTier,
  FeeStructure,
  RevenueShare,
} from "./domain/fee-model";
export {
  FEE_STRUCTURES,
  calculateFee,
  getRevenueShare,
  getFeeStructure,
} from "./domain/fee-model";
export type {
  MetaTransaction,
  X402PaymentRequest,
  X402PaymentReceipt,
  RelayerConfig,
  SponsoredGasStats,
  GasSponsorshipOutcome,
} from "./domain/x402-protocol";
export { X402Relayer } from "./infrastructure/payment/x402-relayer";
export { CapabilityPolicyEngine, recommendedCapabilityPolicy } from "./domain/capability-policy";
export {
  ParticipantRole,
  getRoleCapabilities,
  canPerformAction,
  getRoleRequirements,
  isRoleModule,
  parseParticipantRole,
  type RoleModule,
  type RoleCapabilityActionMap,
  type RoleCapabilityMatrix,
  type RoleRequirements,
} from "./domain/role-matrix";
export {
  ParticipantCategory,
  getParticipantCategory,
  getApplicableRoles,
  isParticipantType,
  isParticipantCategory,
  type ParticipantType,
  type ParticipantMatrixCell,
} from "./domain/participant-matrix";
export {
  selectVerificationLayers,
  calculateVerificationCost,
  isVerificationLayer,
  isVerificationRiskLevel,
  type VerificationLayer,
  type VerificationRiskLevel,
} from "./domain/multi-layer-verification";
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
export type {
  WireVisibility,
  Wire,
  GateType,
  Gate,
  CircuitConstraint,
  ConstraintSystem,
  CircuitDefinition,
  Groth16G1Point,
  Groth16G2Point,
  Groth16Proof,
  CommitmentProof,
  CircuitProofLike,
} from "./domain/zk-circuits";
export {
  zkCircuitDefinitions,
  getCircuitDefinition,
  listCircuitDefinitions,
  isCircuitProofShapeValid,
  verifyCircuitConstraints,
} from "./domain/zk-circuits";
export type {
  SecurityProperty,
  FormalProof,
  FormalVerificationReport,
} from "./domain/zk-formal-verification";
export {
  verifySoundness,
  verifyCompleteness,
  verifyZeroKnowledge,
  verifyFormalSecurityProperties,
} from "./domain/zk-formal-verification";
export {
  runPrivacyExperiment,
  measureInformationLeakage,
  calculatePrivacyScore,
  type PrivacyLevel,
  type PrivacyProofSetting,
  type PrivacyExperimentConfig,
  type PrivacyExperimentObservation,
  type PrivacyExperimentResult,
} from "./domain/zk-privacy-experiment";
export {
  addNoise,
  calculatePrivacyBudget,
  compositionTheorem,
  type DPMechanism,
} from "./domain/differential-privacy";
export {
  validateCompensationModel,
  groupCompensationByAsset,
  type CompensationAsset,
  type CompensationModel,
  type CompensationLeg,
} from "./domain/economics";
export {
  calculateEquilibrium,
  simulateMarketDynamics,
  calculateWelfare,
  type MarketEquilibrium,
  type SupplyDemandPoint,
  type SupplyDemandCurve,
  type MarketSimulationConfig,
  type MarketWelfare,
} from "./domain/labor-market";
export {
  DynamicPricingModel,
  suggestPrice,
  calculateSurgeMultiplier,
  type UrgencyLevel,
  type ComplexityLevel,
  type TaskRequirements,
  type MarketState,
  type PricingSuggestion,
  type DynamicPricingConfig,
} from "./domain/task-pricing";
export {
  NetworkEffectsModel,
  CrossApplicationSynergy,
  NetworkGrowthSimulator,
  calculateNetworkValue,
  projectGrowth,
  calculateSynergyScore,
  type NetworkSnapshot,
  type GrowthProjection,
  type SynergyScore,
  type ApplicationUsage,
} from "./domain/network-effects";
export {
  EcosystemModule,
  getModuleDependencies,
  assessEcosystemHealth,
  calculateCrossAppSynergy,
  type ModuleDependency,
  type ModuleStatSnapshot,
  type EcosystemModuleStats,
  type EcosystemHealthState,
  type ModuleHealth,
  type EcosystemHealth,
  type CrossAppUserActivity,
  type ModuleCoverage,
  type CrossAppSynergy,
} from "./domain/ecosystem";
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
export { PactSecurity } from "./application/modules/pact-security";
export { PactAnalytics } from "./application/modules/pact-analytics";
export { PactEcosystem } from "./application/modules/pact-ecosystem";
export { PactReconciliation } from "./application/modules/pact-reconciliation";
export type {
  ManagedSettlementConnector,
  SettlementConnectorFailure,
  SettlementConnectorHealth,
  SettlementConnectorHealthState,
  SettlementConnectorRequest,
  SettlementConnectorResult,
  SettlementConnectorRetryPolicy,
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
export { FileBackedParticipantRepository } from "./infrastructure/repositories/file-backed-participant-repository";
export { FileBackedTaskRepository } from "./infrastructure/repositories/file-backed-task-repository";
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
export { PactID, ParticipantNotFoundError } from "./application/modules/pact-id";
export { PactTasks } from "./application/modules/pact-tasks";
export { PactPay } from "./application/modules/pact-pay";
export { PactZK } from "./application/modules/pact-zk";
export { PactReputation } from "./application/modules/pact-reputation";
export { PactOrchestrator } from "./application/orchestrator";

export type {
  PactContainer,
  PactContainerEnvironment,
  CreateContainerOptions,
} from "./application/container";
export type {
  AnalyticsPeriod,
  TopCategory,
  TopEarner,
  ModuleRevenue,
  NetworkStats,
  TaskAnalytics,
  EconomicAnalytics,
  SecurityAnalytics,
  PactAnalyticsOptions,
} from "./application/modules/pact-analytics";
export type {
  PactAntiSpamOptions,
  ParticipantActionWindow,
  ParticipantSpamProfile,
} from "./application/modules/pact-anti-spam";
export type {
  ComputeJobInput,
  ComputePricingQuote,
  ComputePricingEngine,
} from "./application/modules/pact-compute";
export type { DataAsset, PublishDataAssetInput } from "./application/modules/pact-data";
export type {
  DevIntegration,
  RegisterDevIntegrationInput,
  RegisterSDKTemplateInput,
} from "./application/modules/pact-dev";
export type { DisputeEvidenceInput, PactDisputesOptions } from "./application/modules/pact-disputes";
export type {
  RegisterCompensationAssetInput,
  RegisterValuationInput,
  BuildCompensationModelInput,
  CompensationQuote,
  ValuationQuote,
  AssetSettlementLine,
  ConnectorHealthReport,
  SettlementPlan,
  ExecuteSettlementInput,
  SettlementExecutionResult,
  ListSettlementRecordsFilter,
  QuerySettlementRecordsInput,
  ReplaySettlementRecordLifecycleInput,
  ReconcileSettlementRecordRequest,
  PactEconomicsOptions,
} from "./application/modules/pact-economics";
export type { PactEcosystemOptions } from "./application/modules/pact-ecosystem";
export type {
  PactReconciliationOptions,
  ReconciliationCycleResult,
  UnreconciledSettlementView,
} from "./application/modules/pact-reconciliation";
export type { RegisterParticipantInput, OnchainParticipantIdentity } from "./application/modules/pact-id";
export type {
  CreateMissionInput,
  AppendExecutionStepInput,
  SubmitEvidenceBundleInput,
  RecordVerdictInput,
  OpenMissionChallengeInput,
  ResolveMissionChallengeInput,
  ChallengeStakePolicy,
  PactMissionsOptions,
} from "./application/modules/pact-missions";
export type { SettlementResult } from "./application/modules/pact-pay";
export type { PublishPluginInput, PluginListingView } from "./application/modules/pact-plugin-marketplace";
export type { PactSecurityOptions, SybilResistanceAssessment } from "./application/modules/pact-security";
export type { CreateTaskInput } from "./application/modules/pact-tasks";
export type { FormalPropertyVerificationResult } from "./application/modules/pact-zk";
