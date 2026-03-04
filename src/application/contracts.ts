import type {
  MissionEnvelope,
  Participant,
  ReputationRecord,
  Task,
  TaskEvidence,
  TaskStatus,
  WorkerProfile,
} from "../domain/types";
import type { ValidationOutcome } from "../domain/validation-pipeline";
import type { EscrowAccount } from "../blockchain/abstraction";

export interface TaskRepository {
  save(task: Task): Promise<void>;
  getById(id: string): Promise<Task | undefined>;
  list(): Promise<Task[]>;
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

export interface ParticipantRepository {
  save(participant: Participant): Promise<void>;
  getById(id: string): Promise<Participant | undefined>;
  listByRole(role: Participant["role"]): Promise<Participant[]>;
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
