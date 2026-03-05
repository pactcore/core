import { describe, expect, it } from "bun:test";
import { createApp } from "../src/api/app";
import {
  calculateSpamScore,
  getStakeRequirement,
  type AntiSpamAction,
} from "../src/domain/anti-spam";
import { PactAntiSpam } from "../src/application/modules/pact-anti-spam";
import { InMemoryAntiSpamRateLimitStore } from "../src/infrastructure/anti-spam/in-memory-anti-spam-rate-limit-store";
import { InMemoryDIDRepository } from "../src/infrastructure/identity/in-memory-did-repository";
import { InMemoryReputationRepository } from "../src/infrastructure/repositories/in-memory-reputation-repository";
import type { DIDDocument } from "../src/domain/types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function createClock(start = 1_700_000_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function createAntiSpamModule(
  action: AntiSpamAction,
  policy: { maxPerHour: number; maxPerDay: number; cooldownMs: number },
) {
  const clock = createClock();
  const module = new PactAntiSpam({
    rateLimitStore: new InMemoryAntiSpamRateLimitStore(),
    now: clock.now,
    rateLimits: {
      [action]: {
        action,
        maxPerHour: policy.maxPerHour,
        maxPerDay: policy.maxPerDay,
        cooldownMs: policy.cooldownMs,
      },
    },
  });

  return {
    module,
    clock,
  };
}

describe("anti-spam domain model", () => {
  it("assigns higher spam scores to riskier participants", () => {
    const trusted = calculateSpamScore({
      accountAgeMs: 180 * DAY_MS,
      reputation: 95,
      recentActivityPerHour: 1,
      stakeAmountCents: 8_000,
    });
    const risky = calculateSpamScore({
      accountAgeMs: 15 * 60 * 1000,
      reputation: 8,
      recentActivityPerHour: 100,
      stakeAmountCents: 0,
    });

    expect(trusted).toBeLessThan(risky);
    expect(trusted).toBeGreaterThanOrEqual(0);
    expect(risky).toBeLessThanOrEqual(100);
  });

  it("increases required stake with spam score and caps at max", () => {
    const low = getStakeRequirement("task_creation", 0);
    const medium = getStakeRequirement("task_creation", 50);
    const high = getStakeRequirement("task_creation", 100);
    const capped = getStakeRequirement("task_creation", 1_000);

    expect(medium).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(medium);
    expect(capped).toBe(high);
    expect(high).toBeLessThanOrEqual(6_000);
  });
});

describe("PactAntiSpam module", () => {
  it("allows actions for a participant with no prior activity", async () => {
    const antiSpam = new PactAntiSpam({
      rateLimitStore: new InMemoryAntiSpamRateLimitStore(),
    });

    const rateLimit = await antiSpam.checkRateLimit("participant-a", "task_creation");
    expect(rateLimit.allowed).toBeTrue();
    expect(rateLimit.retryAfterMs).toBeUndefined();
  });

  it("enforces cooldown windows", async () => {
    const { module: antiSpam, clock } = createAntiSpamModule("task_creation", {
      maxPerHour: 100,
      maxPerDay: 1_000,
      cooldownMs: 60_000,
    });

    await antiSpam.recordAction("participant-a", "task_creation");
    const blocked = await antiSpam.checkRateLimit("participant-a", "task_creation");
    expect(blocked.allowed).toBeFalse();
    expect(blocked.retryAfterMs).toBeGreaterThan(0);

    clock.advance(60_001);
    const allowed = await antiSpam.checkRateLimit("participant-a", "task_creation");
    expect(allowed.allowed).toBeTrue();
  });

  it("enforces hourly action limits", async () => {
    const { module: antiSpam, clock } = createAntiSpamModule("bid_submission", {
      maxPerHour: 2,
      maxPerDay: 100,
      cooldownMs: 0,
    });

    await antiSpam.recordAction("participant-a", "bid_submission");
    await antiSpam.recordAction("participant-a", "bid_submission");
    const blocked = await antiSpam.checkRateLimit("participant-a", "bid_submission");
    expect(blocked.allowed).toBeFalse();
    expect(blocked.retryAfterMs).toBeGreaterThan(0);

    clock.advance(HOUR_MS + 1);
    const allowed = await antiSpam.checkRateLimit("participant-a", "bid_submission");
    expect(allowed.allowed).toBeTrue();
  });

  it("enforces daily action limits", async () => {
    const { module: antiSpam, clock } = createAntiSpamModule("data_listing", {
      maxPerHour: 100,
      maxPerDay: 2,
      cooldownMs: 0,
    });

    await antiSpam.recordAction("participant-a", "data_listing");
    await antiSpam.recordAction("participant-a", "data_listing");
    const blocked = await antiSpam.checkRateLimit("participant-a", "data_listing");
    expect(blocked.allowed).toBeFalse();
    expect(blocked.retryAfterMs).toBeGreaterThan(0);

    clock.advance(DAY_MS + 1);
    const allowed = await antiSpam.checkRateLimit("participant-a", "data_listing");
    expect(allowed.allowed).toBeTrue();
  });

  it("uses account age and reputation when calculating required stake", async () => {
    const clock = createClock();
    const didRepository = new InMemoryDIDRepository();
    const reputationRepository = new InMemoryReputationRepository();
    const antiSpam = new PactAntiSpam({
      rateLimitStore: new InMemoryAntiSpamRateLimitStore(),
      didRepository,
      reputationRepository,
      now: clock.now,
    });

    const trustedDid: DIDDocument = {
      id: "did:pact:trusted",
      controller: "did:pact:trusted",
      verificationMethod: [],
      service: [],
      createdAt: clock.now() - 365 * DAY_MS,
      updatedAt: clock.now() - 365 * DAY_MS,
    };
    await didRepository.save(trustedDid);
    await reputationRepository.save({
      participantId: "trusted",
      role: "worker",
      score: 95,
    });

    const riskyDid: DIDDocument = {
      id: "did:pact:risky",
      controller: "did:pact:risky",
      verificationMethod: [],
      service: [],
      createdAt: clock.now() - 5 * 60 * 1000,
      updatedAt: clock.now() - 5 * 60 * 1000,
    };
    await didRepository.save(riskyDid);
    await reputationRepository.save({
      participantId: "risky",
      role: "worker",
      score: 10,
    });

    const trusted = await antiSpam.calculateRequiredStake("trusted", "task_creation");
    const risky = await antiSpam.calculateRequiredStake("risky", "task_creation");

    expect(trusted.spamScore).toBeLessThan(risky.spamScore);
    expect(trusted.stakeCents).toBeLessThan(risky.stakeCents);
  });

  it("returns participant spam profiles with recent action windows and stake requirements", async () => {
    const clock = createClock();
    const antiSpam = new PactAntiSpam({
      rateLimitStore: new InMemoryAntiSpamRateLimitStore(),
      now: clock.now,
    });

    await antiSpam.recordAction("participant-a", "task_creation");
    clock.advance(10 * 60 * 1000);
    await antiSpam.recordAction("participant-a", "bid_submission");
    clock.advance(10 * 60 * 1000);
    await antiSpam.recordAction("participant-a", "bid_submission");

    const profile = await antiSpam.getParticipantSpamProfile("participant-a");
    expect(profile.spamScore).toBeGreaterThanOrEqual(0);
    expect(profile.spamScore).toBeLessThanOrEqual(100);
    expect(profile.recentActions.task_creation.lastHour).toBe(1);
    expect(profile.recentActions.bid_submission.lastHour).toBe(2);
    expect(profile.stakeRequirements.data_listing).toBeGreaterThan(0);
  });
});

describe("anti-spam API wiring", () => {
  it("exposes anti-spam check/record/profile routes", async () => {
    const app = createApp();
    const checkResp = await app.request("/anti-spam/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        participantId: "route-user",
        action: "task_creation",
      }),
    });

    expect(checkResp.status).toBe(200);
    const checkBody = (await checkResp.json()) as {
      allowed: boolean;
      stakeCents: number;
      spamScore: number;
    };
    expect(checkBody.allowed).toBeTrue();
    expect(checkBody.stakeCents).toBeGreaterThan(0);
    expect(checkBody.spamScore).toBeGreaterThanOrEqual(0);

    const recordResp = await app.request("/anti-spam/record", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        participantId: "route-user",
        action: "task_creation",
      }),
    });
    expect(recordResp.status).toBe(201);

    const profileResp = await app.request("/anti-spam/route-user/profile");
    expect(profileResp.status).toBe(200);
    const profileBody = (await profileResp.json()) as {
      recentActions: {
        task_creation: { lastDay: number };
      };
    };
    expect(profileBody.recentActions.task_creation.lastDay).toBe(1);
  });

  it("enforces optional anti-spam stake checks on task creation", async () => {
    const app = createApp();
    const taskPayload = {
      title: "Spam-resistance task",
      description: "Ensure anti-spam economics are applied",
      issuerId: "issuer-anti-spam",
      paymentCents: 1_000,
      location: { latitude: 0, longitude: 0 },
      constraints: {
        requiredSkills: [],
        maxDistanceKm: 10,
        minReputation: 0,
        capacityRequired: 1,
      },
    };

    const rejected = await app.request("/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...taskPayload,
        stakeCents: 0,
      }),
    });
    expect(rejected.status).toBe(400);

    const accepted = await app.request("/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...taskPayload,
        stakeCents: 10_000,
      }),
    });
    expect(accepted.status).toBe(201);
  });
});
