import { describe, expect, it } from "bun:test";
import type {
  ComputeExecutionAdapter,
  PaymentReceipt,
  ScheduledJob,
} from "../src/application/contracts";
import { DomainEvents } from "../src/application/events";
import { PactOrchestrator } from "../src/application/orchestrator";
import { PactAntiSpam } from "../src/application/modules/pact-anti-spam";
import { PactCompute } from "../src/application/modules/pact-compute";
import { PactData } from "../src/application/modules/pact-data";
import { PactDisputes } from "../src/application/modules/pact-disputes";
import { PactID } from "../src/application/modules/pact-id";
import { PactMissions } from "../src/application/modules/pact-missions";
import { PactPay } from "../src/application/modules/pact-pay";
import { PactReputation } from "../src/application/modules/pact-reputation";
import { PactTasks } from "../src/application/modules/pact-tasks";
import type { DisputeCase } from "../src/domain/dispute-resolution";
import type { Task, TaskEvidence } from "../src/domain/types";
import { ParticipantRole, canPerformAction, getRoleRequirements } from "../src/domain/role-matrix";
import { calculateStakingAPY } from "../src/domain/token-economics";
import {
  type ValidationConfig,
} from "../src/domain/validation-pipeline";
import { InMemoryAgentMailbox } from "../src/infrastructure/agent/in-memory-agent-mailbox";
import { InMemoryAntiSpamRateLimitStore } from "../src/infrastructure/anti-spam/in-memory-anti-spam-rate-limit-store";
import { InMemoryBaseChainGateway } from "../src/infrastructure/blockchain/in-memory-base-chain-gateway";
import { InMemoryComputeProviderRegistry } from "../src/infrastructure/compute/in-memory-compute-provider-registry";
import { InMemoryResourceMeter } from "../src/infrastructure/compute/in-memory-resource-meter";
import { InMemoryDataAccessPolicyRepository } from "../src/infrastructure/data/in-memory-data-access-policy-repository";
import { InMemoryDataAssetRepository } from "../src/infrastructure/data/in-memory-data-asset-repository";
import { InMemoryDataListingRepository } from "../src/infrastructure/data/in-memory-data-listing-repository";
import { InMemoryDataPurchaseRepository } from "../src/infrastructure/data/in-memory-data-purchase-repository";
import { InMemoryIntegrityProofRepository } from "../src/infrastructure/data/in-memory-integrity-proof-repository";
import { InMemoryProvenanceGraph } from "../src/infrastructure/data/in-memory-provenance-graph";
import { InMemoryEventBus } from "../src/infrastructure/event-bus/in-memory-event-bus";
import { InMemoryEventJournal } from "../src/infrastructure/event-bus/in-memory-event-journal";
import { InMemoryCredentialIssuer } from "../src/infrastructure/identity/in-memory-credential-issuer";
import { InMemoryCredentialRepository } from "../src/infrastructure/identity/in-memory-credential-repository";
import { InMemoryDIDRepository } from "../src/infrastructure/identity/in-memory-did-repository";
import { InMemoryParticipantStatsRepository } from "../src/infrastructure/identity/in-memory-participant-stats-repository";
import { InMemoryCreditLineManager } from "../src/infrastructure/payment/in-memory-credit-line-manager";
import { InMemoryGasSponsorshipManager } from "../src/infrastructure/payment/in-memory-gas-sponsorship-manager";
import { InMemoryMicropaymentAggregator } from "../src/infrastructure/payment/in-memory-micropayment-aggregator";
import { InMemoryPaymentRouter } from "../src/infrastructure/payment/in-memory-payment-router";
import { InMemoryX402PaymentAdapter } from "../src/infrastructure/payment/in-memory-x402-payment-adapter";
import { InMemoryDisputeRepository } from "../src/infrastructure/repositories/in-memory-dispute-repository";
import { InMemoryDurableSettlementRecordRepository } from "../src/infrastructure/repositories/in-memory-durable-settlement-record-repository";
import { InMemoryMissionRepository } from "../src/infrastructure/repositories/in-memory-mission-repository";
import { InMemoryParticipantRepository } from "../src/infrastructure/repositories/in-memory-participant-repository";
import { InMemoryReputationRepository } from "../src/infrastructure/repositories/in-memory-reputation-repository";
import { InMemoryTaskRepository } from "../src/infrastructure/repositories/in-memory-task-repository";
import { InMemoryWorkerRepository } from "../src/infrastructure/repositories/in-memory-worker-repository";
import { InMemoryReputationEventRepository } from "../src/infrastructure/reputation/in-memory-reputation-event-repository";
import { InMemoryReputationProfileRepository } from "../src/infrastructure/reputation/in-memory-reputation-profile-repository";
import { InMemoryReputationService } from "../src/infrastructure/reputation/in-memory-reputation-service";
import { InMemoryScheduler } from "../src/infrastructure/scheduler/in-memory-scheduler";
import { InMemoryTaskManager } from "../src/infrastructure/task-manager/in-memory-task-manager";
import { InMemoryValidatorConsensus } from "../src/infrastructure/validator-consensus/in-memory-validator-consensus";
import type { ComputeProvider } from "../src/domain/types";
import { TaskStateMachine } from "../src/domain/task-state-machine";

const FIXED_START = 1_700_000_000_000;
const VALIDATION_CONFIG: ValidationConfig = {
  autoAI: { enabled: true, passThreshold: 0.99 },
  agentValidators: { enabled: true, passThreshold: 1, requiredParticipants: 1 },
  humanJury: { enabled: false, passThreshold: 1, requiredParticipants: 1 },
};

interface SweepFixture {
  eventJournal: InMemoryEventJournal;
  reputationRepository: InMemoryReputationRepository;
  pactAntiSpam: PactAntiSpam;
  pactCompute: PactCompute;
  pactData: PactData;
  pactDisputes: PactDisputes;
  pactID: PactID;
  pactMissions: PactMissions;
  pactPay: PactPay;
  pactReputation: PactReputation;
  pactTasks: PactTasks;
}

function createClock(start = FIXED_START) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function buildComputeResultHash(jobId: string, providerId: string): string {
  return `sha256:${jobId}:${providerId}`;
}

class DeterministicComputeExecutionAdapter implements ComputeExecutionAdapter {
  private runCount = 0;

  async execute(job: ScheduledJob, provider: ComputeProvider) {
    this.runCount += 1;

    const cpuSeconds = 10 + this.runCount;
    const memoryMBHours = 2 + this.runCount;
    const gpuSeconds = provider.capabilities.gpuCount > 0 ? 5 + this.runCount : 0;
    const totalCostCents =
      cpuSeconds * provider.pricePerCpuSecondCents +
      memoryMBHours * provider.pricePerMemoryMBHourCents +
      gpuSeconds * provider.pricePerGpuSecondCents;
    const recordedAt = FIXED_START + this.runCount * 1_000;

    return {
      jobId: job.id,
      providerId: provider.id,
      status: "completed" as const,
      output: buildComputeResultHash(job.id, provider.id),
      usage: {
        id: `usage-${this.runCount}`,
        jobId: job.id,
        providerId: provider.id,
        cpuSeconds,
        memoryMBHours,
        gpuSeconds,
        totalCostCents,
        recordedAt,
      },
      completedAt: recordedAt,
    };
  }
}

function createFixture(): SweepFixture {
  const eventJournal = new InMemoryEventJournal();
  const eventBus = new InMemoryEventBus(eventJournal);
  const clock = createClock();
  const participantRepository = new InMemoryParticipantRepository();
  const workerRepository = new InMemoryWorkerRepository();
  const reputationRepository = new InMemoryReputationRepository();
  const reputationService = new InMemoryReputationService(reputationRepository);
  const taskManager = new InMemoryTaskManager(new InMemoryTaskRepository(), new TaskStateMachine());

  const pactPay = new PactPay(
    new InMemoryBaseChainGateway(),
    new InMemoryX402PaymentAdapter(),
    "treasury",
    new InMemoryPaymentRouter(),
    new InMemoryMicropaymentAggregator(),
    new InMemoryCreditLineManager(),
    new InMemoryGasSponsorshipManager(),
  );
  const pactTasks = new PactTasks(taskManager, workerRepository, eventBus, pactPay);
  const orchestrator = new PactOrchestrator(
    eventBus,
    new InMemoryValidatorConsensus(VALIDATION_CONFIG),
    pactTasks,
    pactPay,
    reputationService,
  );
  orchestrator.register();

  const didRepository = new InMemoryDIDRepository();
  const participantStatsRepository = new InMemoryParticipantStatsRepository();
  const pactID = new PactID(
    participantRepository,
    workerRepository,
    reputationService,
    didRepository,
    new InMemoryCredentialIssuer("integration-sweep-secret"),
    new InMemoryCredentialRepository(),
    participantStatsRepository,
  );

  const pactAntiSpam = new PactAntiSpam({
    rateLimitStore: new InMemoryAntiSpamRateLimitStore(),
    participantStatsRepository,
    reputationRepository,
    didRepository,
    now: clock.now,
  });

  const pactData = new PactData(
    new InMemoryDataAssetRepository(),
    new InMemoryProvenanceGraph(),
    new InMemoryIntegrityProofRepository(),
    new InMemoryDataAccessPolicyRepository(),
    new InMemoryDataListingRepository(),
    new InMemoryDataPurchaseRepository(),
  );

  const pactCompute = new PactCompute(
    new InMemoryScheduler(),
    new InMemoryComputeProviderRegistry(),
    new InMemoryResourceMeter(),
    new DeterministicComputeExecutionAdapter(),
  );

  const missionRepository = new InMemoryMissionRepository();
  const pactMissions = new PactMissions(
    missionRepository,
    participantRepository,
    new InMemoryAgentMailbox(),
    eventBus,
    undefined,
    { settlementRecordRepository: new InMemoryDurableSettlementRecordRepository() },
  );
  const pactDisputes = new PactDisputes(
    new InMemoryDisputeRepository(),
    missionRepository,
    participantRepository,
    reputationRepository,
    eventBus,
    {
      config: {
        jurySize: 3,
        votingPeriodMs: 0,
        evidencePeriodMs: 0,
        minJuryReputation: 60,
      },
    },
  );

  const pactReputation = new PactReputation(
    new InMemoryReputationProfileRepository(),
    new InMemoryReputationEventRepository(),
  );

  return {
    eventJournal,
    reputationRepository,
    pactAntiSpam,
    pactCompute,
    pactData,
    pactDisputes,
    pactID,
    pactMissions,
    pactPay,
    pactReputation,
    pactTasks,
  };
}

function paymentTo(receipts: PaymentReceipt[], to: string): number {
  return receipts
    .filter((receipt) => receipt.to === to)
    .reduce((sum, receipt) => sum + receipt.amountCents, 0);
}

function createEvidence(validatorId: string): TaskEvidence {
  return {
    summary: "deterministic evidence",
    artifactUris: ["ipfs://integration-sweep/evidence"],
    submittedAt: FIXED_START,
    validation: {
      autoAIScore: 0.5,
      agentVotes: [{ participantId: validatorId, approve: true }],
      humanVotes: [],
    },
  };
}

async function registerTaskActors(fixture: SweepFixture): Promise<void> {
  await fixture.pactID.registerParticipant({
    id: "issuer-1",
    role: "issuer",
    displayName: "Issuer One",
    initialReputation: 85,
  });
  await fixture.pactID.registerParticipant({
    id: "worker-1",
    role: "worker",
    displayName: "Worker One",
    skills: ["vision", "geo"],
    capacity: 1,
    initialReputation: 80,
    location: { latitude: 0, longitude: 0 },
  });
  await fixture.pactID.registerParticipant({
    id: "validator-1",
    role: "validator",
    displayName: "Validator One",
    initialReputation: 90,
  });
}

async function completeValidatedTask(
  fixture: SweepFixture,
  paymentCents = 10_000,
): Promise<{ task: Task; receipts: PaymentReceipt[] }> {
  const task = await fixture.pactTasks.createTask({
    title: "Sweep task",
    description: "cross-module settlement",
    issuerId: "issuer-1",
    paymentCents,
    location: { latitude: 0, longitude: 0 },
    constraints: {
      requiredSkills: ["vision"],
      maxDistanceKm: 5,
      minReputation: 70,
      capacityRequired: 1,
    },
  });
  await fixture.pactTasks.assignTask(task.id, "worker-1");
  await fixture.pactTasks.submitEvidence(task.id, createEvidence("validator-1"));

  const completed = await fixture.pactTasks.getTask(task.id);
  const receipts = (await fixture.pactPay.ledger()).filter((receipt) => receipt.reference === task.id);
  return { task: completed, receipts };
}

async function registerDisputeActors(fixture: SweepFixture): Promise<void> {
  await fixture.pactID.registerParticipant({
    id: "issuer-2",
    role: "issuer",
    displayName: "Issuer Two",
    initialReputation: 88,
  });
  await fixture.pactID.registerParticipant({
    id: "agent-2",
    role: "agent",
    displayName: "Agent Two",
    initialReputation: 82,
  });
  await fixture.pactID.registerParticipant({
    id: "validator-2",
    role: "validator",
    displayName: "Validator Two",
    initialReputation: 85,
  });
  await fixture.pactID.registerParticipant({
    id: "jury-1",
    role: "jury",
    displayName: "Jury One",
    initialReputation: 95,
  });
  await fixture.pactID.registerParticipant({
    id: "jury-2",
    role: "jury",
    displayName: "Jury Two",
    initialReputation: 94,
  });
  await fixture.pactID.registerParticipant({
    id: "jury-3",
    role: "jury",
    displayName: "Jury Three",
    initialReputation: 93,
  });
}

async function createDispute(fixture: SweepFixture): Promise<DisputeCase> {
  const mission = await fixture.pactMissions.createMission({
    issuerId: "issuer-2",
    title: "Dispute mission",
    budgetCents: 8_000,
    targetAgentIds: ["agent-2"],
    context: {
      objective: "deterministic dispute fixture",
      constraints: ["no pii"],
      successCriteria: ["deterministic outputs"],
    },
  });
  await fixture.pactMissions.claimMission(mission.id, "agent-2");

  return fixture.pactDisputes.openDispute(mission.id, "validator-2", {
    description: "validation mismatch",
    artifactUris: ["ipfs://integration-sweep/dispute"],
  });
}

async function applyReputationImpactFromDispute(
  fixture: SweepFixture,
  dispute: DisputeCase,
): Promise<void> {
  const outcome = dispute.verdict?.outcome;
  if (!outcome) {
    return;
  }

  if (outcome === "upheld") {
    await fixture.pactReputation.recordEvent(
      dispute.challengerId,
      "verification_accuracy",
      8,
      `dispute:${dispute.id}:upheld`,
    );
    await fixture.pactReputation.recordEvent(
      dispute.respondentId,
      "verification_accuracy",
      -8,
      `dispute:${dispute.id}:upheld_against`,
    );
    return;
  }

  if (outcome === "rejected") {
    await fixture.pactReputation.recordEvent(
      dispute.challengerId,
      "verification_accuracy",
      -6,
      `dispute:${dispute.id}:rejected`,
    );
    await fixture.pactReputation.recordEvent(
      dispute.respondentId,
      "verification_accuracy",
      6,
      `dispute:${dispute.id}:respondent_won`,
    );
  }
}

function provider(id: string): ComputeProvider {
  return {
    id,
    name: `provider-${id}`,
    capabilities: {
      cpuCores: 8,
      memoryMB: 16_384,
      gpuCount: 1,
      gpuModel: "A100",
    },
    pricePerCpuSecondCents: 2,
    pricePerGpuSecondCents: 4,
    pricePerMemoryMBHourCents: 3,
    status: "available",
    registeredAt: FIXED_START,
  };
}

describe("Integration sweep: Task -> Pay -> Settlement", () => {
  it("settles verified task payouts deterministically", async () => {
    const fixture = createFixture();
    await registerTaskActors(fixture);

    const { task, receipts } = await completeValidatedTask(fixture, 10_000);

    expect(task.status).toBe("Completed");
    expect(task.validatorIds).toEqual(["validator-1"]);
    expect(receipts).toHaveLength(4);
    expect(paymentTo(receipts, "worker-1")).toBe(8_500);
    expect(paymentTo(receipts, "validator-1")).toBe(500);
    expect(paymentTo(receipts, "issuer-1")).toBe(500);
    expect(paymentTo(receipts, "treasury")).toBe(500);
    expect(receipts.reduce((sum, receipt) => sum + receipt.amountCents, 0)).toBe(10_000);
  });

  it("emits ordered lifecycle events across task settlement", async () => {
    const fixture = createFixture();
    await registerTaskActors(fixture);
    await completeValidatedTask(fixture, 9_000);

    const names = (await fixture.eventJournal.replay()).map((record) => record.event.name);
    const createdAt = names.indexOf(DomainEvents.TaskCreated);
    const assignedAt = names.indexOf(DomainEvents.TaskAssigned);
    const submittedAt = names.indexOf(DomainEvents.TaskSubmitted);
    const verifiedAt = names.indexOf(DomainEvents.TaskVerified);
    const completedAt = names.indexOf(DomainEvents.TaskCompleted);

    expect(createdAt).toBeGreaterThanOrEqual(0);
    expect(createdAt).toBeLessThan(assignedAt);
    expect(assignedAt).toBeLessThan(submittedAt);
    expect(submittedAt).toBeLessThan(verifiedAt);
    expect(verifiedAt).toBeLessThan(completedAt);
    expect(names.includes(DomainEvents.TaskValidationFailed)).toBe(false);
  });
});

describe("Integration sweep: Identity verification -> Task eligibility -> Reputation update", () => {
  it("uses verified identity capability before assigning an eligible worker", async () => {
    const fixture = createFixture();
    await registerTaskActors(fixture);

    const credential = await fixture.pactID.issueCredential(
      "issuer-1",
      "worker-1",
      "tasks.execute.vision",
    );
    expect(await fixture.pactID.verifyCredential(credential)).toBe(true);
    expect(await fixture.pactID.checkCapability("worker-1", "tasks.execute.vision")).toBe(true);

    const task = await fixture.pactTasks.createTask({
      title: "Eligibility check",
      description: "worker must match skills and reputation",
      issuerId: "issuer-1",
      paymentCents: 4_500,
      location: { latitude: 0, longitude: 0 },
      constraints: {
        requiredSkills: ["vision"],
        maxDistanceKm: 3,
        minReputation: 75,
        capacityRequired: 1,
      },
    });
    const assigned = await fixture.pactTasks.assignTask(task.id, "worker-1");
    expect(assigned.assigneeId).toBe("worker-1");
  });

  it("raises worker and validator base reputation after successful verification", async () => {
    const fixture = createFixture();
    await registerTaskActors(fixture);

    await fixture.pactID.issueCredential("issuer-1", "worker-1", "tasks.execute.vision");
    const beforeWorker = await fixture.reputationRepository.get("worker-1");
    const beforeValidator = await fixture.reputationRepository.get("validator-1");
    expect(beforeWorker?.score).toBe(80);
    expect(beforeValidator?.score).toBe(90);

    await completeValidatedTask(fixture, 8_000);

    const afterWorker = await fixture.reputationRepository.get("worker-1");
    const afterValidator = await fixture.reputationRepository.get("validator-1");
    expect(afterWorker?.score).toBe(82);
    expect(afterValidator?.score).toBe(91);
  });
});

describe("Integration sweep: Data asset -> Compute job -> Result verification", () => {
  it("links compute output to an integrity proof for a published data asset", async () => {
    const fixture = createFixture();
    const source = await fixture.pactData.publish({
      ownerId: "data-owner-1",
      title: "Input Dataset",
      uri: "ipfs://integration-sweep/source",
    });
    const cp = provider("p1");
    await fixture.pactCompute.registerProvider(cp);

    const job = await fixture.pactCompute.enqueueComputeJob({
      image: "python:3.12",
      command: "python transform.py",
      runAt: FIXED_START,
    });
    const due = await fixture.pactCompute.runDue(FIXED_START);
    expect(due.map((entry) => entry.id)).toContain(job.id);

    const result = await fixture.pactCompute.dispatchJob(job.id, cp.id);
    const outputHash = buildComputeResultHash(job.id, cp.id);
    expect(result.output).toBe(outputHash);

    await fixture.pactData.registerIntegrityProof(source.id, outputHash);
    expect(await fixture.pactData.verifyIntegrity(source.id, outputHash)).toBe(true);
  });

  it("tracks compute-derived lineage and rejects incorrect result hashes", async () => {
    const fixture = createFixture();
    const cp = provider("p2");
    await fixture.pactCompute.registerProvider(cp);

    const raw = await fixture.pactData.publish({
      ownerId: "data-owner-2",
      title: "Raw Batch",
      uri: "ipfs://integration-sweep/raw",
    });
    const job = await fixture.pactCompute.enqueueComputeJob({
      image: "node:22",
      command: "node derive.js",
      runAt: FIXED_START,
    });
    await fixture.pactCompute.runDue(FIXED_START);
    const result = await fixture.pactCompute.dispatchJob(job.id, cp.id);

    const derived = await fixture.pactData.publish({
      ownerId: "data-owner-2",
      title: "Derived Batch",
      uri: `ipfs://integration-sweep/derived/${result.jobId}`,
      derivedFrom: [raw.id],
    });
    const lineage = await fixture.pactData.getLineage(derived.id);
    expect(lineage.map((edge) => edge.parentId)).toContain(raw.id);

    const outputHash = buildComputeResultHash(job.id, cp.id);
    await fixture.pactData.registerIntegrityProof(derived.id, outputHash);
    expect(await fixture.pactData.verifyIntegrity(derived.id, "sha256:wrong")).toBe(false);
    expect(await fixture.pactData.verifyIntegrity(derived.id, outputHash)).toBe(true);
  });
});

describe("Integration sweep: Anti-spam -> Dispute -> Resolution -> Reputation impact", () => {
  it("applies positive/negative reputation impact after an upheld dispute", async () => {
    const fixture = createFixture();
    await registerDisputeActors(fixture);

    const initialRate = await fixture.pactAntiSpam.checkRateLimit("validator-2", "task_creation");
    expect(initialRate.allowed).toBe(true);
    await fixture.pactAntiSpam.recordAction("validator-2", "task_creation");
    const profile = await fixture.pactAntiSpam.getParticipantSpamProfile("validator-2");
    expect(profile.recentActions.task_creation.lastDay).toBe(1);

    const dispute = await createDispute(fixture);
    await fixture.pactDisputes.closeEvidencePeriod(dispute.id);
    await fixture.pactDisputes.castJuryVote(dispute.id, "jury-1", "uphold", "evidence is consistent");
    const resolved = await fixture.pactDisputes.castJuryVote(
      dispute.id,
      "jury-2",
      "uphold",
      "logs align",
    );

    expect(resolved.status).toBe("resolved");
    expect(resolved.verdict?.outcome).toBe("upheld");
    await applyReputationImpactFromDispute(fixture, resolved);

    const challenger = await fixture.pactReputation.getProfile("validator-2");
    const respondent = await fixture.pactReputation.getProfile("agent-2");
    expect(challenger.overallScore).toBeGreaterThan(50);
    expect(respondent.overallScore).toBeLessThan(50);
  });

  it("keeps dispute reputation neutral on split jury outcomes", async () => {
    const fixture = createFixture();
    await registerDisputeActors(fixture);

    const dispute = await createDispute(fixture);
    await fixture.pactDisputes.closeEvidencePeriod(dispute.id);
    await fixture.pactDisputes.castJuryVote(dispute.id, "jury-1", "uphold", "partial support");
    const resolved = await fixture.pactDisputes.castJuryVote(
      dispute.id,
      "jury-2",
      "reject",
      "partial rejection",
    );

    expect(resolved.status).toBe("resolved");
    expect(resolved.verdict?.outcome).toBe("split");
    await applyReputationImpactFromDispute(fixture, resolved);

    const challenger = await fixture.pactReputation.getProfile("validator-2");
    const respondent = await fixture.pactReputation.getProfile("agent-2");
    expect(challenger.overallScore).toBe(50);
    expect(respondent.overallScore).toBe(50);
  });
});

describe("Integration sweep: Token staking -> Validator role -> Verification reward", () => {
  it("maps stake thresholds to validator role capabilities and projected staking yield", async () => {
    const fixture = createFixture();
    const requirements = getRoleRequirements(ParticipantRole.Validator);
    const stakedCents = requirements.minStake + 500;

    expect(canPerformAction(ParticipantRole.Validator, "validate", "tasks")).toBe(true);
    expect(stakedCents).toBeGreaterThanOrEqual(requirements.minStake);
    expect(calculateStakingAPY(stakedCents, 300)).toBeGreaterThan(0);

    const stakeRoute = await fixture.pactPay.routePayment(
      "validator-1",
      "staking-vault",
      stakedCents,
      "PACT",
      "stake:validator-1",
    );
    expect(stakeRoute.status).toBe("completed");
    expect(stakeRoute.routeType).toBe("direct");
  });

  it("rewards a staked validator through task verification settlement payouts", async () => {
    const fixture = createFixture();
    await registerTaskActors(fixture);
    const requirements = getRoleRequirements(ParticipantRole.Validator);
    const stakedCents = requirements.minStake + 1_000;
    await fixture.pactPay.routePayment(
      "validator-1",
      "staking-vault",
      stakedCents,
      "PACT",
      "stake:validator-1",
    );

    const paymentCents = 12_000;
    const { task, receipts } = await completeValidatedTask(fixture, paymentCents);
    const validatorReward = paymentTo(receipts, "validator-1");

    expect(task.status).toBe("Completed");
    expect(canPerformAction(ParticipantRole.Validator, "validate", "tasks")).toBe(true);
    expect(stakedCents).toBeGreaterThanOrEqual(requirements.minStake);
    expect(validatorReward).toBe(600);
    expect(validatorReward).toBe(Math.floor(paymentCents * 0.05));
  });
});
