export { createApp } from "./api/app";
export { createContainer } from "./application/container";
export { TaskStateMachine } from "./domain/task-state-machine";
export { MissionStateMachine } from "./domain/mission-state-machine";
export {
  postChallengeStake,
  settleChallengeStakeUpheld,
  settleChallengeStakeRejected,
  calculateChallengePenalty,
  splitForfeitedChallengeStake,
} from "./domain/challenge-stake";
export { ThreeLayerValidationPipeline } from "./domain/validation-pipeline";
export { ReputationModel } from "./domain/reputation";
export { GaleShapleyMatcher } from "./domain/matching";
export { PaymentSplitService } from "./domain/payment-split";
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
export { PactMissions } from "./application/modules/pact-missions";
export { PactHeartbeat } from "./application/modules/pact-heartbeat";
export { PactEconomics } from "./application/modules/pact-economics";
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
export { InMemoryHeartbeatSupervisor } from "./infrastructure/heartbeat/in-memory-heartbeat-supervisor";
export { FileBackedEventJournal } from "./infrastructure/event-bus/file-backed-event-journal";
export { InMemoryLlmTokenMeteringConnector } from "./infrastructure/settlement/in-memory-llm-token-metering-connector";
export { InMemoryCloudCreditBillingConnector } from "./infrastructure/settlement/in-memory-cloud-credit-billing-connector";
export { InMemoryApiQuotaAllocationConnector } from "./infrastructure/settlement/in-memory-api-quota-allocation-connector";
export { InMemoryDurableSettlementRecordRepository } from "./infrastructure/repositories/in-memory-durable-settlement-record-repository";
export { FileBackedDurableSettlementRecordRepository } from "./infrastructure/repositories/file-backed-durable-settlement-record-repository";
export { FileBackedMissionRepository } from "./infrastructure/repositories/file-backed-mission-repository";

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

// Module exports
export { PactCompute } from "./application/modules/pact-compute";
export { PactData } from "./application/modules/pact-data";
export { PactDev } from "./application/modules/pact-dev";
export { PactID } from "./application/modules/pact-id";
export { PactTasks } from "./application/modules/pact-tasks";
export { PactPay } from "./application/modules/pact-pay";
export { PactZK } from "./application/modules/pact-zk";
