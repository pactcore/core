import type {
  MissionEnvelope,
  Participant,
  ParticipantRole,
  ParticipantStats,
  ReputationRecord,
  Task,
  TaskEvidence,
  TaskStatus,
  WorkerProfile,
} from "../domain/types";
import type {
  ReputationCategory,
  ReputationEvent,
  ReputationProfile,
} from "../domain/reputation-multi";
import type { AntiSpamAction } from "../domain/anti-spam";
import type { DisputeCase } from "../domain/dispute-resolution";
import type { ValidationOutcome } from "../domain/validation-pipeline";
import type { ZKProof, ZKProofRequest, ZKProofType } from "../domain/zk-proofs";
import type { EscrowAccount } from "../blockchain/abstraction";
import type {
  CreditLine,
  GasSponsorshipGrant,
  MicropaymentBatch,
  PaymentRoute,
} from "../domain/payment-routing";

export interface TaskRepository {
  save(task: Task): Promise<void>;
  getById(id: string): Promise<Task | undefined>;
  list(): Promise<Task[]>;
}

export interface AntiSpamActionRecord {
  participantId: string;
  action: AntiSpamAction;
  occurredAt: number;
  stakeCents: number;
}

export interface AntiSpamParticipantState {
  participantId: string;
  firstSeenAt?: number;
  totalStakeCents: number;
  actions: AntiSpamActionRecord[];
}

export interface AntiSpamRateLimitStore {
  getParticipantState(participantId: string): Promise<AntiSpamParticipantState>;
  listParticipantActions(
    participantId: string,
    action?: AntiSpamAction,
  ): Promise<AntiSpamActionRecord[]>;
  recordAction(record: AntiSpamActionRecord): Promise<void>;
}

export interface MissionQueryFilter {
  id?: string;
  issuerId?: string;
  status?: MissionEnvelope["status"];
  claimedBy?: string;
  targetAgentId?: string;
  createdAfter?: number;
  createdBefore?: number;
  updatedAfter?: number;
  updatedBefore?: number;
}

export interface MissionPageRequest {
  cursor?: string;
  limit?: number;
}

export interface MissionPage {
  items: MissionEnvelope[];
  nextCursor?: string;
}

export type MissionLifecycleAction = "created" | "updated";

export interface MissionLifecycleEntry {
  offset: number;
  action: MissionLifecycleAction;
  missionId: string;
  status: MissionEnvelope["status"];
  occurredAt: number;
  mission: MissionEnvelope;
}

export interface MissionReplayRequest {
  fromOffset?: number;
  limit?: number;
}

export interface MissionReplayPage {
  entries: MissionLifecycleEntry[];
  nextOffset?: number;
}

export interface MissionRepository {
  save(mission: MissionEnvelope): Promise<void>;
  getById(id: string): Promise<MissionEnvelope | undefined>;
  list(): Promise<MissionEnvelope[]>;
  query(filter?: MissionQueryFilter, page?: MissionPageRequest): Promise<MissionPage>;
  replay(request?: MissionReplayRequest): Promise<MissionReplayPage>;
}

export interface DisputeRepository {
  save(dispute: DisputeCase): Promise<void>;
  getById(id: string): Promise<DisputeCase | undefined>;
  list(status?: DisputeCase["status"]): Promise<DisputeCase[]>;
}

export interface ParticipantRepository {
  save(participant: Participant): Promise<void>;
  getById(id: string): Promise<Participant | undefined>;
  listByRole(role: Participant["role"]): Promise<Participant[]>;
}

export interface ParticipantStatsRepository {
  save(stats: ParticipantStats): Promise<void>;
  get(participantId: string): Promise<ParticipantStats | undefined>;
}

export interface WorkerRepository {
  save(worker: WorkerProfile): Promise<void>;
  getById(id: string): Promise<WorkerProfile | undefined>;
  list(): Promise<WorkerProfile[]>;
}

export interface ReputationRepository {
  save(record: ReputationRecord): Promise<void>;
  get(participantId: string): Promise<ReputationRecord | undefined>;
}

export interface ReputationProfileRepository {
  save(profile: ReputationProfile): Promise<void>;
  get(participantId: string): Promise<ReputationProfile | undefined>;
  list(): Promise<ReputationProfile[]>;
}

export interface ReputationEventRepository {
  save(event: ReputationEvent): Promise<void>;
  getByParticipant(participantId: string, limit?: number): Promise<ReputationEvent[]>;
  getByCategory(category: ReputationCategory, limit?: number): Promise<ReputationEvent[]>;
}

export interface ReputationService {
  getScore(participantId: string): Promise<number>;
  setScore(participantId: string, role: ReputationRecord["role"], score: number): Promise<ReputationRecord>;
  adjustScore(participantId: string, role: ReputationRecord["role"], delta: number): Promise<ReputationRecord>;
}

export interface EventBus {
  publish<TPayload>(event: DomainEvent<TPayload>): Promise<void>;
  subscribe<TPayload>(eventName: string, handler: EventHandler<TPayload>): void;
}

export interface DomainEvent<TPayload> {
  name: string;
  payload: TPayload;
  createdAt: number;
}

export interface EventJournalRecord {
  offset: number;
  event: DomainEvent<unknown>;
}

export interface EventJournal {
  append(event: DomainEvent<unknown>): Promise<EventJournalRecord>;
  replay(fromOffset?: number, limit?: number): Promise<EventJournalRecord[]>;
  latestOffset(): Promise<number>;
}

export interface AgentMailboxMessage {
  id: string;
  agentId: string;
  direction: "inbox" | "outbox";
  topic: string;
  payload: unknown;
  createdAt: number;
  ackedAt?: number;
}

export interface AgentMailbox {
  enqueueInbox(agentId: string, topic: string, payload: unknown): Promise<AgentMailboxMessage>;
  enqueueOutbox(agentId: string, topic: string, payload: unknown): Promise<AgentMailboxMessage>;
  pullInbox(agentId: string, limit?: number): Promise<AgentMailboxMessage[]>;
  listOutbox(agentId: string, limit?: number): Promise<AgentMailboxMessage[]>;
  ackInbox(agentId: string, messageId: string): Promise<void>;
}

export type EventHandler<TPayload> = (event: DomainEvent<TPayload>) => Promise<void> | void;

export interface TaskManager {
  create(task: Task): Promise<Task>;
  assign(taskId: string, workerId: string): Promise<Task>;
  submit(taskId: string, evidence: TaskEvidence): Promise<Task>;
  verify(taskId: string, validatorIds: string[]): Promise<Task>;
  complete(taskId: string): Promise<Task>;
  setStatus(taskId: string, status: TaskStatus): Promise<Task>;
  get(taskId: string): Promise<Task | undefined>;
  list(): Promise<Task[]>;
}

export interface ValidatorConsensus {
  evaluate(evidence: TaskEvidence): Promise<ValidationOutcome>;
}

export interface Scheduler {
  schedule(job: ScheduledJob): Promise<void>;
  runDue(now?: number): Promise<ScheduledJob[]>;
}

export interface ScheduledJob {
  id: string;
  topic: string;
  payload: unknown;
  runAt: number;
}

export interface HeartbeatTask {
  id: string;
  name: string;
  intervalMs: number;
  enabled: boolean;
  payload?: Record<string, unknown>;
  lastRunAt?: number;
  nextRunAt: number;
}

export interface RegisterHeartbeatTaskInput {
  name: string;
  intervalMs: number;
  payload?: Record<string, unknown>;
  startAt?: number;
}

export interface HeartbeatExecution {
  task: HeartbeatTask;
  executedAt: number;
}

export interface HeartbeatSupervisor {
  registerTask(input: RegisterHeartbeatTaskInput): Promise<HeartbeatTask>;
  listTasks(): Promise<HeartbeatTask[]>;
  enableTask(taskId: string): Promise<HeartbeatTask>;
  disableTask(taskId: string): Promise<HeartbeatTask>;
  tick(now?: number): Promise<HeartbeatExecution[]>;
}

export interface X402PaymentAdapter {
  transfer(transfer: PaymentTransfer): Promise<PaymentReceipt>;
  ledger(): Promise<PaymentReceipt[]>;
}

export interface PaymentTransfer {
  from: string;
  to: string;
  amountCents: number;
  reference: string;
}

export interface PaymentReceipt extends PaymentTransfer {
  txId: string;
  executedAt: number;
}

export interface BlockchainGateway {
  createEscrow(taskId: string, payerId: string, amountCents: number): Promise<EscrowAccount>;
  releaseEscrow(taskId: string, payouts: Record<string, number>): Promise<string>;
  getEscrow(taskId: string): Promise<EscrowAccount | undefined>;
}

export interface PaymentRouter {
  route(
    fromId: string,
    toId: string,
    amount: number,
    currency: string,
    reference: string,
  ): Promise<PaymentRoute>;
}

export interface MicropaymentAggregator {
  addEntry(payerId: string, payeeId: string, amountCents: number): Promise<void>;
  flush(payerId: string): Promise<MicropaymentBatch>;
}

export interface CreditLineManager {
  open(
    issuerId: string,
    borrowerId: string,
    limitCents: number,
    interestBps: number,
    expiresAt?: number,
  ): Promise<CreditLine>;
  use(lineId: string, amountCents: number): Promise<CreditLine>;
  repay(lineId: string, amountCents: number): Promise<CreditLine>;
  getLine(lineId: string): Promise<CreditLine | undefined>;
  listByBorrower(borrowerId: string): Promise<CreditLine[]>;
}

export interface GasSponsorshipManager {
  grant(sponsorId: string, beneficiaryId: string, maxGasCents: number): Promise<GasSponsorshipGrant>;
  useGas(grantId: string, gasCents: number): Promise<GasSponsorshipGrant>;
  getGrant(grantId: string): Promise<GasSponsorshipGrant | undefined>;
}

// ── PactCompute contracts ──────────────────────────────────────

import type {
  ComputeProvider,
  ComputeUsageRecord,
  ComputeJobResult,
  DIDDocument,
  VerifiableCredential,
  ProvenanceEdge,
  IntegrityProof,
  DataAccessPolicy,
  PolicyPackage,
  PolicyEvaluationResult,
  SDKTemplate,
} from "../domain/types";
import type {
  DataCategory,
  DataListing,
  DataPurchase,
} from "../domain/data-marketplace";
import type {
  PluginInstall,
  PluginListing,
  PluginPackage,
  RevenueShare,
} from "../domain/plugin-marketplace";
import type { DataAsset } from "../application/modules/pact-data";

export interface ComputeProviderRegistry {
  registerProvider(provider: ComputeProvider): Promise<void>;
  getProvider(id: string): Promise<ComputeProvider | undefined>;
  listProviders(): Promise<ComputeProvider[]>;
  findProvidersByCapability(minCpu: number, minMemory: number, minGpu?: number): Promise<ComputeProvider[]>;
}

export interface ResourceMeter {
  record(usage: ComputeUsageRecord): Promise<void>;
  getByJob(jobId: string): Promise<ComputeUsageRecord[]>;
  getByProvider(providerId: string): Promise<ComputeUsageRecord[]>;
  listAll(): Promise<ComputeUsageRecord[]>;
}

export interface ComputeExecutionAdapter {
  execute(job: ScheduledJob, provider: ComputeProvider): Promise<ComputeJobResult>;
}

// ── PactID / DID contracts ─────────────────────────────────────

export interface DIDRepository {
  save(doc: DIDDocument): Promise<void>;
  getByDID(did: string): Promise<DIDDocument | undefined>;
  getByParticipantId(participantId: string): Promise<DIDDocument | undefined>;
}

export interface CredentialIssuer {
  issue(credential: Omit<VerifiableCredential, "id" | "proof">): Promise<VerifiableCredential>;
  verify(credential: VerifiableCredential): Promise<boolean>;
}

export interface CredentialRepository {
  save(credential: VerifiableCredential): Promise<void>;
  getById(id: string): Promise<VerifiableCredential | undefined>;
  getBySubject(subjectId: string): Promise<VerifiableCredential[]>;
  getBySubjectAndCapability(subjectId: string, capability: string): Promise<VerifiableCredential[]>;
}

export interface OnchainIdentityRecord {
  role: ParticipantRole | string;
  level: number;
  registeredAt: number;
}

export interface IdentitySBTContractClient {
  mint(to: string, participantId: string, role: ParticipantRole | string, level: number): Promise<bigint>;
  upgradeLevel(tokenId: bigint, newLevel: number): Promise<string>;
  getIdentity(tokenId: bigint): Promise<OnchainIdentityRecord | undefined>;
}

// ── PactZK contracts ─────────────────────────────────────────

export interface ZKProver {
  generate(request: ZKProofRequest, witness: unknown): Promise<ZKProof>;
}

export interface ZKVerifier {
  verify(proof: ZKProof): Promise<boolean>;
}

export interface ZKProofRepository {
  save(proof: ZKProof): Promise<void>;
  getById(id: string): Promise<ZKProof | undefined>;
  getByProver(proverId: string): Promise<ZKProof[]>;
  getByType(type: ZKProofType): Promise<ZKProof[]>;
}

// ── PactData contracts ─────────────────────────────────────────

export interface ProvenanceGraph {
  addEdge(edge: ProvenanceEdge): Promise<void>;
  getLineage(assetId: string): Promise<ProvenanceEdge[]>;
  getDependents(assetId: string): Promise<ProvenanceEdge[]>;
}

export interface IntegrityProofRepository {
  save(proof: IntegrityProof): Promise<void>;
  getByAsset(assetId: string): Promise<IntegrityProof | undefined>;
}

export interface DataAccessPolicyRepository {
  save(policy: DataAccessPolicy): Promise<void>;
  getByAsset(assetId: string): Promise<DataAccessPolicy | undefined>;
}

export interface DataAssetRepository {
  save(asset: DataAsset): Promise<void>;
  getById(id: string): Promise<DataAsset | undefined>;
  list(): Promise<DataAsset[]>;
}

export interface DataListingRepository {
  save(listing: DataListing): Promise<void>;
  getById(id: string): Promise<DataListing | undefined>;
  listByCategory(category: DataCategory): Promise<DataListing[]>;
  listBySeller(sellerId: string): Promise<DataListing[]>;
  listActive(): Promise<DataListing[]>;
}

export interface DataPurchaseRepository {
  save(purchase: DataPurchase): Promise<void>;
  getById(id: string): Promise<DataPurchase | undefined>;
  listByBuyer(buyerId: string): Promise<DataPurchase[]>;
  listByAsset(assetId: string): Promise<DataPurchase[]>;
}

// ── PactDev Plugin Marketplace contracts ──────────────────────

export interface PluginPackageRepository {
  save(pkg: PluginPackage): Promise<void>;
  getById(id: string): Promise<PluginPackage | undefined>;
  listByDeveloper(developerId: string): Promise<PluginPackage[]>;
}

export interface PluginListingRepository {
  save(listing: PluginListing): Promise<void>;
  getById(id: string): Promise<PluginListing | undefined>;
  listByDeveloper(developerId: string): Promise<PluginListing[]>;
  listActive(): Promise<PluginListing[]>;
}

export interface PluginInstallRepository {
  save(install: PluginInstall): Promise<void>;
  listByPlugin(pluginId: string): Promise<PluginInstall[]>;
  listByInstaller(installerId: string): Promise<PluginInstall[]>;
}

export interface PluginRevenueShareRepository {
  save(revenueShare: RevenueShare): Promise<void>;
  listByPlugin(pluginId: string): Promise<RevenueShare[]>;
  listByDeveloper(developerId: string): Promise<RevenueShare[]>;
}

// ── PactDev contracts ──────────────────────────────────────────

export interface PolicyRegistry {
  registerPackage(pkg: PolicyPackage): Promise<void>;
  getPackage(id: string): Promise<PolicyPackage | undefined>;
  listPackages(): Promise<PolicyPackage[]>;
  evaluatePolicy(context: Record<string, unknown>): Promise<PolicyEvaluationResult>;
}

export interface TemplateRepository {
  save(template: SDKTemplate): Promise<void>;
  getById(id: string): Promise<SDKTemplate | undefined>;
  list(): Promise<SDKTemplate[]>;
}
