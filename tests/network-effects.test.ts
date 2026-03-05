import { describe, expect, it } from "bun:test";
import {
  calculateNetworkValue,
  calculateSynergyScore,
  projectGrowth,
  type ApplicationUsage,
} from "../src/domain/network-effects";
import {
  assessAgentCapability,
  calculateAutonomyLevel,
  type AgentCapabilityHistoryEntry,
} from "../src/domain/agent-autonomy";

describe("network effects model", () => {
  it("network value increases with participant growth", () => {
    const smallerNetwork = calculateNetworkValue(300, 5, 20_000);
    const largerNetwork = calculateNetworkValue(600, 5, 20_000);

    expect(largerNetwork).toBeGreaterThan(smallerNetwork);
  });

  it("network value increases with application and transaction depth", () => {
    const baseline = calculateNetworkValue(500, 3, 5_000);
    const higherDepth = calculateNetworkValue(500, 8, 60_000);

    expect(higherDepth).toBeGreaterThan(baseline);
  });
});

describe("cross-application synergy", () => {
  it("synergy score increases when more participants use multiple apps", () => {
    const singleAppUsage: ApplicationUsage[] = [
      { participantId: "p1", applicationId: "tasks" },
      { participantId: "p2", applicationId: "tasks" },
      { participantId: "p3", applicationId: "tasks" },
      { participantId: "p4", applicationId: "tasks" },
    ];

    const multiAppUsage: ApplicationUsage[] = [
      { participantId: "p1", applicationId: "tasks" },
      { participantId: "p1", applicationId: "pay" },
      { participantId: "p2", applicationId: "tasks" },
      { participantId: "p2", applicationId: "compute" },
      { participantId: "p3", applicationId: "tasks" },
      { participantId: "p3", applicationId: "id" },
      { participantId: "p4", applicationId: "tasks" },
      { participantId: "p4", applicationId: "pay" },
    ];

    const singleAppScore = calculateSynergyScore(singleAppUsage);
    const multiAppScore = calculateSynergyScore(multiAppUsage);

    expect(multiAppScore.score).toBeGreaterThan(singleAppScore.score);
    expect(multiAppScore.amplificationFactor).toBeGreaterThan(singleAppScore.amplificationFactor);
  });

  it("returns neutral synergy metrics for empty usage history", () => {
    const score = calculateSynergyScore([]);
    expect(score.score).toBe(0);
    expect(score.amplificationFactor).toBe(1);
    expect(score.participantCount).toBe(0);
  });
});

describe("growth projection", () => {
  it("projects month-by-month growth for the requested horizon", () => {
    const projections = projectGrowth(
      {
        participants: 400,
        applications: 6,
        transactions: 25_000,
      },
      12,
    );

    expect(projections).toHaveLength(12);
    expect(projections[0]?.month).toBe(1);
    expect(projections[11]?.month).toBe(12);
  });

  it("produces monotonic growth and a decelerating participant curve", () => {
    const projections = projectGrowth(
      {
        participants: 500,
        applications: 5,
        transactions: 30_000,
      },
      12,
    );

    for (let index = 1; index < projections.length; index += 1) {
      const previous = projections[index - 1];
      const current = projections[index];
      if (!previous || !current) {
        continue;
      }
      expect(current.participants).toBeGreaterThanOrEqual(previous.participants);
      expect(current.applications).toBeGreaterThanOrEqual(previous.applications);
      expect(current.transactions).toBeGreaterThanOrEqual(previous.transactions);
      expect(current.networkValue).toBeGreaterThanOrEqual(previous.networkValue);
    }

    const firstGrowth = projections[0]?.participantGrowthRate ?? 0;
    const lastGrowth = projections[11]?.participantGrowthRate ?? 0;
    expect(lastGrowth).toBeLessThan(firstGrowth);
  });
});

describe("agent autonomy scoring", () => {
  it("maps autonomy metrics into the 1-5 level scale", () => {
    expect(
      calculateAutonomyLevel({
        decisionAccuracy: 95,
        taskCompletionRate: 92,
        errorRecoveryRate: 90,
        humanInterventionRate: 5,
      }),
    ).toBe(5);

    expect(
      calculateAutonomyLevel({
        decisionAccuracy: 20,
        taskCompletionRate: 30,
        errorRecoveryRate: 10,
        humanInterventionRate: 85,
      }),
    ).toBe(1);
  });

  it("assesses capability metrics from participant-specific history", () => {
    const history: AgentCapabilityHistoryEntry[] = [
      {
        participantId: "agent-a",
        decisionAccurate: true,
        completed: true,
        humanInterventionRequired: false,
      },
      {
        participantId: "agent-a",
        decisionAccurate: true,
        completed: false,
        encounteredError: true,
        recoveredFromError: true,
        humanInterventionRequired: true,
      },
      {
        participantId: "agent-a",
        decisionAccurate: false,
        completed: true,
        humanInterventionRequired: false,
      },
      {
        participantId: "agent-a",
        decisionAccurate: true,
        completed: true,
        humanInterventionRequired: false,
      },
      {
        participantId: "agent-b",
        decisionAccurate: false,
        completed: false,
        encounteredError: true,
        recoveredFromError: false,
        humanInterventionRequired: true,
      },
    ];

    const metrics = assessAgentCapability("agent-a", history);
    expect(metrics.decisionAccuracy).toBe(75);
    expect(metrics.taskCompletionRate).toBe(75);
    expect(metrics.errorRecoveryRate).toBe(100);
    expect(metrics.humanInterventionRate).toBe(25);
    expect(calculateAutonomyLevel(metrics)).toBe(4);
  });
});
