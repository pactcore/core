import type {
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
