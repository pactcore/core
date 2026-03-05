import { describe, expect, test } from "bun:test";
import { PactReputation } from "../src/application/modules/pact-reputation";
import {
  calculateOverallScore,
  determineReputationLevel,
  type ReputationDimension,
} from "../src/domain/reputation-multi";
import { InMemoryReputationEventRepository } from "../src/infrastructure/reputation/in-memory-reputation-event-repository";
import { InMemoryReputationProfileRepository } from "../src/infrastructure/reputation/in-memory-reputation-profile-repository";

function setup() {
  const profileRepository = new InMemoryReputationProfileRepository();
  const eventRepository = new InMemoryReputationEventRepository();
  const reputation = new PactReputation(profileRepository, eventRepository);
  return { reputation, profileRepository, eventRepository };
}

describe("Multi-dimensional reputation", () => {
  test("initialize profile has 5 dimensions at default 50", async () => {
    const { reputation } = setup();
    const profile = await reputation.initializeProfile("participant-1");

    expect(profile.dimensions).toHaveLength(5);
    expect(profile.dimensions.every((dimension) => dimension.score === 50)).toBe(true);
    expect(profile.overallScore).toBe(50);
  });

  test("record positive event increases dimension score", async () => {
    const { reputation } = setup();
    await reputation.initializeProfile("participant-2");

    const updated = await reputation.recordEvent(
      "participant-2",
      "task_completion",
      12,
      "completed on time",
    );

    const dimension = updated.dimensions.find((entry) => entry.category === "task_completion");
    expect(dimension?.score).toBe(62);
  });

  test("record negative event decreases score and clamps at 0", async () => {
    const { reputation } = setup();
    await reputation.initializeProfile("participant-3");

    const updated = await reputation.recordEvent(
      "participant-3",
      "payment_reliability",
      -100,
      "missed payment",
    );

    const dimension = updated.dimensions.find((entry) => entry.category === "payment_reliability");
    expect(dimension?.score).toBe(0);
  });

  test("overall score is weighted average", () => {
    const dimensions: ReputationDimension[] = [
      {
        category: "task_completion",
        score: 90,
        weight: 3,
        updatedAt: Date.now(),
      },
      {
        category: "verification_accuracy",
        score: 50,
        weight: 1,
        updatedAt: Date.now(),
      },
    ];

    expect(calculateOverallScore(dimensions)).toBe(80);
  });

  test("time decay moves scores toward 50", async () => {
    const { reputation, profileRepository } = setup();
    const profile = await reputation.initializeProfile("participant-4");
    const halfLifeMs = 30 * 24 * 60 * 60 * 1_000;
    const now = Date.now();

    const boostedProfile = {
      ...profile,
      dimensions: profile.dimensions.map((dimension) =>
        dimension.category === "task_completion"
          ? { ...dimension, score: 100, updatedAt: now - halfLifeMs }
          : dimension,
      ),
    };

    await profileRepository.save(boostedProfile);
    const decayed = await reputation.applyDecay("participant-4");
    const dimension = decayed.dimensions.find((entry) => entry.category === "task_completion");
    expect(dimension).toBeDefined();
    expect(dimension!.score).toBeCloseTo(75, 2);
  });

  test("reputation level thresholds map correctly", () => {
    expect(determineReputationLevel(29.99, 10)).toBe("newcomer");
    expect(determineReputationLevel(30, 10)).toBe("regular");
    expect(determineReputationLevel(60, 10)).toBe("established");
    expect(determineReputationLevel(85, 10)).toBe("expert");
  });

  test("leaderboard sorts correctly", async () => {
    const { reputation } = setup();

    await reputation.initializeProfile("alice");
    await reputation.initializeProfile("bob");
    await reputation.initializeProfile("carol");

    await reputation.recordEvent("alice", "responsiveness", 25, "very fast replies");
    await reputation.recordEvent("bob", "responsiveness", 10, "fast replies");
    await reputation.recordEvent("carol", "responsiveness", -20, "slow replies");

    const leaderboard = await reputation.getLeaderboard("responsiveness", 3);
    expect(leaderboard.map((entry) => entry.participantId)).toEqual(["alice", "bob", "carol"]);
  });

  test("event history tracks all changes", async () => {
    const { reputation } = setup();
    await reputation.initializeProfile("participant-5");

    await reputation.recordEvent("participant-5", "skill_expertise", 5, "passed advanced test");
    await reputation.recordEvent("participant-5", "verification_accuracy", -2, "review mismatch");
    await reputation.recordEvent("participant-5", "task_completion", 3, "consistent completions");

    const history = await reputation.getHistory("participant-5");
    const profile = await reputation.getProfile("participant-5");

    expect(history).toHaveLength(3);
    expect(profile.history).toHaveLength(3);
    expect(history.some((event) => event.reason === "passed advanced test")).toBe(true);
    expect(history.some((event) => event.reason === "review mismatch")).toBe(true);
    expect(history.some((event) => event.reason === "consistent completions")).toBe(true);
  });
});
