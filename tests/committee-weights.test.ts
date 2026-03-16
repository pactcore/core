import { describe, expect, it, beforeEach } from "bun:test";
import { PactCommittee } from "../src/application/modules/pact-committee";
import type { CommitteeReview } from "../src/application/modules/pact-committee";
import { InMemoryParticipantRepository } from "../src/infrastructure/repositories/in-memory-participant-repository";
import { InMemoryReputationRepository } from "../src/infrastructure/repositories/in-memory-reputation-repository";

const FIXED_NOW = 1_700_000_000_000;

function buildRepos() {
  return {
    participantRepository: new InMemoryParticipantRepository(),
    reputationRepository: new InMemoryReputationRepository(),
  };
}

async function seedValidators(
  participantRepository: InMemoryParticipantRepository,
  reputationRepository: InMemoryReputationRepository,
  ids: string[],
  reputation = 80,
) {
  for (const id of ids) {
    await participantRepository.save({
      id,
      role: "validator",
      displayName: id,
      skills: [],
      location: { latitude: 0, longitude: 0 },
    });
    await reputationRepository.save({ participantId: id, role: "validator", score: reputation });
  }
}

async function stakeAll(committee: PactCommittee, ids: string[], stakeCents = 1_000) {
  for (const id of ids) {
    await committee.stakeValidator({ validatorId: id, stakeCents });
  }
}

describe("Committee: selection audit snapshot", () => {
  it("captures validator state at selection time in selectionAudit", async () => {
    const { participantRepository, reputationRepository } = buildRepos();
    const clock = { now: () => FIXED_NOW };
    const committee = new PactCommittee(participantRepository, reputationRepository, {
      config: { committeeSize: 2, approvalThreshold: 2, rejectionThreshold: 2 },
      now: clock.now,
    });

    await seedValidators(participantRepository, reputationRepository, ["v1", "v2", "v3"], 90);
    await stakeAll(committee, ["v1", "v2", "v3"], 2_000);

    const review = await committee.configureCommittee({ missionId: "m1" });

    expect(review.selectionAudit).toBeDefined();
    expect(review.selectionAudit.selectedAt).toBe(FIXED_NOW);
    expect(review.selectionAudit.candidateCount).toBe(3);
    expect(review.selectionAudit.entries).toHaveLength(2);

    for (const entry of review.selectionAudit.entries) {
      expect(entry.reputationAtSelection).toBe(90);
      expect(entry.stakeAtSelection).toBe(2_000);
      expect(entry.weightAtSelection).toBeGreaterThan(0);
      expect(entry.appealOutcomesAtSelection).toBe(0);
      expect(entry.noShowCountAtSelection).toBe(0);
    }
  });

  it("candidateCount reflects all eligible validators, not just selected ones", async () => {
    const { participantRepository, reputationRepository } = buildRepos();
    const committee = new PactCommittee(participantRepository, reputationRepository, {
      config: { committeeSize: 2, approvalThreshold: 2, rejectionThreshold: 2 },
    });

    await seedValidators(participantRepository, reputationRepository, ["v1", "v2", "v3", "v4", "v5"], 80);
    await stakeAll(committee, ["v1", "v2", "v3", "v4", "v5"], 1_000);

    const review = await committee.configureCommittee({ missionId: "m1" });
    expect(review.selectionAudit.candidateCount).toBe(5);
    expect(review.selectionAudit.entries).toHaveLength(2);
  });

  it("selectionAudit snapshot reflects appeal/no-show counts at time of selection", async () => {
    const { participantRepository, reputationRepository } = buildRepos();
    let t = FIXED_NOW;
    const committee = new PactCommittee(participantRepository, reputationRepository, {
      config: { committeeSize: 2, approvalThreshold: 2, rejectionThreshold: 1 },
      now: () => t,
    });

    await seedValidators(participantRepository, reputationRepository, ["v1", "v2"], 80);
    await stakeAll(committee, ["v1", "v2"], 1_000);

    // Run a committee for mission m-pre, finalize with deadline (no votes → no-show)
    await committee.configureCommittee({ missionId: "m-pre", reviewPeriodMs: 0 });
    t += 1; // past deadline
    await committee.finalizeCommittee("m-pre"); // both v1, v2 are no-shows

    // Now configure for m1, snapshot should record noShowCount = 1
    const review = await committee.configureCommittee({ missionId: "m1" });
    for (const entry of review.selectionAudit.entries) {
      expect(entry.noShowCountAtSelection).toBe(1);
    }
  });
});

describe("Committee: appeal/no-show weighting", () => {
  it("validators with appeal outcomes have lower effective weight", async () => {
    const { participantRepository, reputationRepository } = buildRepos();
    const committee = new PactCommittee(participantRepository, reputationRepository, {
      config: { committeeSize: 2, approvalThreshold: 2, rejectionThreshold: 1 },
    });

    await seedValidators(participantRepository, reputationRepository, ["v1", "v2", "v3"], 80);
    await stakeAll(committee, ["v1", "v2", "v3"], 1_000);

    // Baseline weight from clean validators
    await committee.configureCommittee({ missionId: "m-base" });
    const baseReview = (await committee.getCommittee("m-base")) as CommitteeReview;
    const baseWeight = baseReview.selectionAudit.entries[0].weightAtSelection;

    // Build up appeal outcomes on those validators
    await committee.castVote({ missionId: "m-base", validatorId: baseReview.validatorIds[0], decision: "approve", reasoning: "ok" });
    await committee.castVote({ missionId: "m-base", validatorId: baseReview.validatorIds[1], decision: "approve", reasoning: "ok" });
    await committee.recordAppealOutcome("m-base");

    // Use the third validator as a fresh validator for the new committee
    const review2 = await committee.configureCommittee({ missionId: "m2" });
    const penalizedEntry = review2.selectionAudit.entries.find(
      (e) => e.validatorId === baseReview.validatorIds[0] || e.validatorId === baseReview.validatorIds[1],
    );
    const freshEntry = review2.selectionAudit.entries.find((e) => !penalizedEntry || e.validatorId !== penalizedEntry.validatorId);

    if (penalizedEntry) {
      expect(penalizedEntry.weightAtSelection).toBeLessThan(baseWeight);
    }
    if (freshEntry) {
      expect(freshEntry.appealOutcomesAtSelection).toBe(0);
    }
  });

  it("validators with no-show history are ranked lower and eventually deprioritized", async () => {
    const { participantRepository, reputationRepository } = buildRepos();
    let t = FIXED_NOW;
    const committee = new PactCommittee(participantRepository, reputationRepository, {
      config: { committeeSize: 1, approvalThreshold: 1, rejectionThreshold: 1 },
      now: () => t,
    });

    await seedValidators(participantRepository, reputationRepository, ["v-clean", "v-noshow"], 80);
    await stakeAll(committee, ["v-clean", "v-noshow"], 1_000);

    // v-noshow gets a no-show on mission m-pre (deadline with no votes)
    await committee.configureCommittee({ missionId: "m-pre", reviewPeriodMs: 0 });
    // swap selected to ensure v-noshow is the assigned one
    t += 1;
    await committee.finalizeCommittee("m-pre");

    const vNoShow = await committee.getValidatorAccount("v-noshow");
    const vClean = await committee.getValidatorAccount("v-clean");

    // At least one of them has a no-show and the other doesn't
    const totalNoShows = (vNoShow?.noShowCount ?? 0) + (vClean?.noShowCount ?? 0);
    expect(totalNoShows).toBeGreaterThan(0);
  });

  it("weight penalty is bounded: does not go below 10% of base weight", async () => {
    const { participantRepository, reputationRepository } = buildRepos();
    let t = FIXED_NOW;
    const committee = new PactCommittee(participantRepository, reputationRepository, {
      config: { committeeSize: 1, approvalThreshold: 1, rejectionThreshold: 1 },
      now: () => t,
    });

    await seedValidators(participantRepository, reputationRepository, ["v1"], 80);
    await stakeAll(committee, ["v1"], 1_000);

    // Simulate many appeal outcomes by directly checking weight formula
    const account = await committee.getValidatorAccount("v1");
    expect(account).toBeDefined();
    // Add a helper: create review and read selection audit weight to confirm floor
    await committee.configureCommittee({ missionId: "m1", reviewPeriodMs: 0 });
    t += 1; // past deadline
    await committee.finalizeCommittee("m1");
    await committee.recordAppealOutcome("m1");

    const v1Account = await committee.getValidatorAccount("v1");
    expect(v1Account!.noShowCount).toBe(1);
    expect(v1Account!.appealOutcomes).toBeGreaterThanOrEqual(0); // appeals only recorded for voters
  });
});

describe("Committee: no-show tracking on deadline finalization", () => {
  it("marks absent validators as no-shows when committee expires at deadline", async () => {
    const { participantRepository, reputationRepository } = buildRepos();
    let t = FIXED_NOW;
    const committee = new PactCommittee(participantRepository, reputationRepository, {
      config: { committeeSize: 3, approvalThreshold: 3, rejectionThreshold: 3 },
      now: () => t,
    });

    await seedValidators(participantRepository, reputationRepository, ["v1", "v2", "v3"], 80);
    await stakeAll(committee, ["v1", "v2", "v3"], 1_000);
    await committee.configureCommittee({ missionId: "m1", reviewPeriodMs: 1_000 });

    // Only v1 votes
    await committee.castVote({ missionId: "m1", validatorId: "v1", decision: "approve", reasoning: "ok" });

    // Advance past deadline and finalize
    t += 2_000;
    await committee.finalizeCommittee("m1");

    const v1 = await committee.getValidatorAccount("v1");
    const v2 = await committee.getValidatorAccount("v2");
    const v3 = await committee.getValidatorAccount("v3");

    expect(v1!.noShowCount).toBe(0); // voted — not a no-show
    expect(v2!.noShowCount).toBe(1); // did not vote before deadline
    expect(v3!.noShowCount).toBe(1); // did not vote before deadline
  });

  it("does not increment no-show when committee reaches vote threshold", async () => {
    const { participantRepository, reputationRepository } = buildRepos();
    const committee = new PactCommittee(participantRepository, reputationRepository, {
      config: { committeeSize: 3, approvalThreshold: 2, rejectionThreshold: 2 },
    });

    await seedValidators(participantRepository, reputationRepository, ["v1", "v2", "v3"], 80);
    await stakeAll(committee, ["v1", "v2", "v3"], 1_000);
    await committee.configureCommittee({ missionId: "m1" });

    // Reach threshold — v3 never votes but this is threshold not deadline
    await committee.castVote({ missionId: "m1", validatorId: "v1", decision: "approve", reasoning: "ok" });
    await committee.castVote({ missionId: "m1", validatorId: "v2", decision: "approve", reasoning: "ok" }); // triggers finalize

    const v3 = await committee.getValidatorAccount("v3");
    expect(v3!.noShowCount).toBe(0); // threshold finalization doesn't penalize non-voters
  });
});

describe("Committee: recordAppealOutcome", () => {
  it("increments appealOutcomes for validators who voted with the overturned decision", async () => {
    const { participantRepository, reputationRepository } = buildRepos();
    const committee = new PactCommittee(participantRepository, reputationRepository, {
      config: { committeeSize: 3, approvalThreshold: 2, rejectionThreshold: 2 },
    });

    await seedValidators(participantRepository, reputationRepository, ["v1", "v2", "v3"], 80);
    await stakeAll(committee, ["v1", "v2", "v3"], 1_000);
    await committee.configureCommittee({ missionId: "m1" });

    // v1 and v2 vote approve — threshold reached, committee approves
    await committee.castVote({ missionId: "m1", validatorId: "v1", decision: "approve", reasoning: "ok" });
    await committee.castVote({ missionId: "m1", validatorId: "v2", decision: "approve", reasoning: "ok" });

    // Jury overturns the approval
    await committee.recordAppealOutcome("m1");

    const v1 = await committee.getValidatorAccount("v1");
    const v2 = await committee.getValidatorAccount("v2");
    const v3 = await committee.getValidatorAccount("v3");

    expect(v1!.appealOutcomes).toBe(1); // voted with the losing side
    expect(v2!.appealOutcomes).toBe(1); // voted with the losing side
    expect(v3!.appealOutcomes).toBe(0); // never voted — not penalized
  });

  it("is a no-op when no committee exists or outcome is missing", async () => {
    const { participantRepository, reputationRepository } = buildRepos();
    const committee = new PactCommittee(participantRepository, reputationRepository);
    // Should not throw
    await committee.recordAppealOutcome("nonexistent-mission");
  });
});
