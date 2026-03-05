import { describe, expect, it } from "bun:test";
import { createApp } from "../src/api/app";
import { PactSecurity } from "../src/application/modules/pact-security";
import { FrontRunningDetector, ReplayAttackPrevention, SybilResistanceScore } from "../src/domain/network-security";
import { assessRisk, buildThreatModel } from "../src/domain/security-threat-model";
import { InMemoryAntiSpamRateLimitStore } from "../src/infrastructure/anti-spam/in-memory-anti-spam-rate-limit-store";
import { InMemoryDIDRepository } from "../src/infrastructure/identity/in-memory-did-repository";
import { InMemoryParticipantStatsRepository } from "../src/infrastructure/identity/in-memory-participant-stats-repository";

describe("security threat model", () => {
  it("returns the full §12.1 threat catalog", () => {
    const threats = buildThreatModel();
    expect(threats).toHaveLength(8);

    const categories = [...new Set(threats.map((threat) => threat.category))].sort();
    expect(categories).toEqual([
      "collusion",
      "data_poisoning",
      "ddos",
      "front_running",
      "identity_theft",
      "replay_attack",
      "smart_contract_exploit",
      "sybil_attack",
    ]);
  });

  it("returns defensive copies from buildThreatModel", () => {
    const initial = buildThreatModel();
    const first = initial[0];
    if (!first) {
      throw new Error("Expected catalog entries");
    }

    first.mitigations.push("tamper");
    const fresh = buildThreatModel();
    expect(fresh[0]?.mitigations.includes("tamper")).toBeFalse();
  });

  it("assesses risk and returns bounded overall scores", () => {
    const audit = assessRisk({
      participants: 500,
      transactions: 8_000,
      disputes: 120,
      avgReputation: 74,
    });

    expect(audit.timestamp).toBeGreaterThan(0);
    expect(audit.threats).toHaveLength(8);
    expect(audit.overallRiskScore).toBeGreaterThanOrEqual(0);
    expect(audit.overallRiskScore).toBeLessThanOrEqual(100);
    expect(audit.recommendations.length).toBeGreaterThan(0);
  });

  it("raises risk when dispute rate grows and reputation drops", () => {
    const stable = assessRisk({
      participants: 750,
      transactions: 9_000,
      disputes: 8,
      avgReputation: 92,
    });
    const stressed = assessRisk({
      participants: 750,
      transactions: 9_000,
      disputes: 640,
      avgReputation: 35,
    });

    expect(stressed.overallRiskScore).toBeGreaterThan(stable.overallRiskScore);
  });
});

describe("network security primitives", () => {
  it("computes higher sybil resistance for stronger identity and stake signals", () => {
    const low = SybilResistanceScore.calculate({
      identityVerificationRate: 0.1,
      averageStakeCents: 80,
      minimumStakeCents: 500,
    });
    const high = SybilResistanceScore.calculate({
      identityVerificationRate: 1,
      averageStakeCents: 1_000,
      minimumStakeCents: 500,
    });

    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(100);
  });

  it("detects suspiciously timed transactions for front-running", () => {
    const detector = new FrontRunningDetector({
      suspiciousWindowMs: 1_000,
      strictReferenceMatch: true,
    });

    const alerts = detector.detect([
      { id: "tx-1", participantId: "alice", timestamp: 10_000, referenceId: "order-1" },
      { id: "tx-2", participantId: "bob", timestamp: 10_350, referenceId: "order-1" },
      { id: "tx-3", participantId: "carol", timestamp: 13_000, referenceId: "order-1" },
    ]);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.leadingTransactionId).toBe("tx-1");
    expect(alerts[0]?.trailingTransactionId).toBe("tx-2");
    expect(alerts[0]?.confidence).toBeGreaterThan(0);
  });

  it("prevents replay attacks with strict nonce sequencing", () => {
    const replayGuard = new ReplayAttackPrevention();

    const first = replayGuard.verify("participant-1", 0);
    expect(first.accepted).toBeTrue();
    expect(first.expectedNextNonce).toBe(1);

    const replay = replayGuard.verify("participant-1", 0);
    expect(replay.accepted).toBeFalse();
    expect(replay.reason).toBe("replay_detected");

    const gap = replayGuard.verify("participant-1", 2);
    expect(gap.accepted).toBeFalse();
    expect(gap.reason).toBe("nonce_gap");

    const second = replayGuard.verify("participant-1", 1);
    expect(second.accepted).toBeTrue();
  });
});

describe("PactSecurity module + API wiring", () => {
  it("calculates participant sybil resistance from identity and stake history", async () => {
    const statsRepository = new InMemoryParticipantStatsRepository();
    const didRepository = new InMemoryDIDRepository();
    const antiSpamStore = new InMemoryAntiSpamRateLimitStore();

    await statsRepository.save({
      participantId: "worker-secure",
      taskCount: 10,
      completedTaskCount: 9,
      reputation: 88,
      hasZKProofOfHumanity: false,
      hasPhoneVerification: true,
      hasIdVerification: true,
    });
    await didRepository.save({
      id: "did:pact:worker-secure",
      controller: "did:pact:worker-secure",
      verificationMethod: [],
      service: [],
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
    await antiSpamStore.recordAction({
      participantId: "worker-secure",
      action: "task_creation",
      occurredAt: 1_700_000_001_000,
      stakeCents: 500,
    });
    await antiSpamStore.recordAction({
      participantId: "worker-secure",
      action: "data_listing",
      occurredAt: 1_700_000_002_000,
      stakeCents: 900,
    });

    const security = new PactSecurity({
      participantStatsRepository: statsRepository,
      didRepository,
      antiSpamRateLimitStore: antiSpamStore,
    });
    const assessment = await security.checkSybilResistance("worker-secure");

    expect(assessment.identityVerificationRate).toBe(0.75);
    expect(assessment.averageStakeCents).toBe(700);
    expect(assessment.minimumStakeCents).toBe(900);
    expect(assessment.score).toBeGreaterThan(70);
  });

  it("verifies nonces through PactSecurity", () => {
    const security = new PactSecurity();

    expect(security.verifyNonce("alice", 0).accepted).toBeTrue();
    const replay = security.verifyNonce("alice", 0);
    expect(replay.accepted).toBeFalse();
    expect(replay.reason).toBe("replay_detected");
  });

  it("exposes security threats, audit, and sybil resistance routes", async () => {
    const app = createApp();

    const threatsResponse = await app.request("/security/threats");
    expect(threatsResponse.status).toBe(200);
    const threatsBody = (await threatsResponse.json()) as Array<{ category: string }>;
    expect(threatsBody).toHaveLength(8);

    const auditResponse = await app.request("/security/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        participants: 120,
        transactions: 900,
        disputes: 12,
        avgReputation: 81,
      }),
    });
    expect(auditResponse.status).toBe(200);
    const auditBody = (await auditResponse.json()) as {
      overallRiskScore: number;
      threats: Array<{ id: string }>;
    };
    expect(auditBody.overallRiskScore).toBeGreaterThanOrEqual(0);
    expect(auditBody.threats.length).toBe(8);

    const sybilResponse = await app.request("/security/sybil-resistance/route-user");
    expect(sybilResponse.status).toBe(200);
    const sybilBody = (await sybilResponse.json()) as {
      participantId: string;
      score: number;
    };
    expect(sybilBody.participantId).toBe("route-user");
    expect(sybilBody.score).toBeGreaterThanOrEqual(0);
    expect(sybilBody.score).toBeLessThanOrEqual(100);
  });
});
