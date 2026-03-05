import { describe, expect, it } from "bun:test";
import { createApp } from "../src/api/app";
import { calculateFee, getRevenueShare } from "../src/domain/fee-model";
import {
  TOKENOMICS_MODEL,
  calculateBurnRate,
  calculateCirculatingSupply,
  calculateStakingAPY,
  getDistribution,
  projectTokenSupply,
} from "../src/domain/token-economics";

const MONTH_MS = 30 * 24 * 60 * 60 * 1_000;

describe("Token economics domain", () => {
  it("returns seven-application distribution that sums to total supply", () => {
    const distribution = getDistribution();
    expect(distribution.length).toBe(7);

    const totalAllocated = distribution.reduce(
      (sum, allocation) => sum + allocation.allocationAmount,
      0,
    );
    expect(totalAllocated).toBe(TOKENOMICS_MODEL.token.totalSupply);
  });

  it("calculates circulating supply at launch from initial unlock values", () => {
    const expectedInitial = getDistribution().reduce(
      (sum, allocation) =>
        sum + allocation.allocationAmount * (allocation.initialUnlockPercent / 100),
      0,
    );

    const circulating = calculateCirculatingSupply(TOKENOMICS_MODEL.token.launchTimestamp);
    expect(circulating).toBeCloseTo(expectedInitial, 6);
  });

  it("increases circulating supply after vesting cliffs pass", () => {
    const before = calculateCirculatingSupply(TOKENOMICS_MODEL.token.launchTimestamp + 2 * MONTH_MS);
    const after = calculateCirculatingSupply(TOKENOMICS_MODEL.token.launchTimestamp + 10 * MONTH_MS);
    expect(after).toBeGreaterThan(before);
  });

  it("caps circulating supply at total supply in long-term horizon", () => {
    const farFuture = TOKENOMICS_MODEL.token.launchTimestamp + 120 * MONTH_MS;
    const circulating = calculateCirculatingSupply(farFuture);
    expect(circulating).toBe(TOKENOMICS_MODEL.token.totalSupply);
  });

  it("calculates staking APY from emission and total stake", () => {
    const apy = calculateStakingAPY(1_000_000, 120_000);
    expect(apy).toBe(12);
  });

  it("calculates burned amount from volume and burn percent", () => {
    const burned = calculateBurnRate(2_000_000, 1.5);
    expect(burned).toBe(30_000);
  });

  it("projects supply for requested month horizon", () => {
    const projection = projectTokenSupply(6);
    expect(projection.length).toBe(6);

    const first = projection[0];
    const last = projection[5];
    if (!first || !last) {
      throw new Error("expected projection entries");
    }

    expect(first.month).toBe(1);
    expect(last.month).toBe(6);
    expect(last.timestamp).toBeGreaterThan(first.timestamp);
    expect(last.circulatingSupply).toBeGreaterThanOrEqual(first.circulatingSupply);
  });
});

describe("Fee model", () => {
  it("applies volume tiers for larger task amounts", () => {
    const lowVolumeFee = calculateFee(500, "tasks");
    const highVolumeFee = calculateFee(20_000, "tasks");
    expect(lowVolumeFee).toBe(12.5);
    expect(highVolumeFee).toBe(400);
  });

  it("splits protocol fee into protocol, validator, and treasury shares", () => {
    const share = getRevenueShare(100);
    expect(share.protocol).toBe(50);
    expect(share.validator).toBe(30);
    expect(share.treasury).toBe(20);
    expect(share.protocol + share.validator + share.treasury).toBe(share.total);
  });
});

describe("Token economics API", () => {
  it("serves token distribution", async () => {
    const app = createApp();
    const response = await app.request("/economics/token/distribution");
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      token: { symbol: string };
      distribution: Array<{ application: string }>;
    };
    expect(payload.token.symbol).toBe("PACT");
    expect(payload.distribution.length).toBe(7);
  });

  it("returns projected supply with default month horizon", async () => {
    const app = createApp();
    const response = await app.request("/economics/token/supply");
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      months: number;
      projections: Array<{ month: number }>;
    };
    expect(payload.months).toBe(12);
    expect(payload.projections.length).toBe(12);
  });

  it("validates months query parameter", async () => {
    const app = createApp();
    const response = await app.request("/economics/token/supply?months=0");
    expect(response.status).toBe(400);
  });

  it("calculates APY via API", async () => {
    const app = createApp();
    const response = await app.request("/economics/token/apy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        totalStaked: 1_000_000,
        emissionRate: 150_000,
      }),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { apy: number };
    expect(payload.apy).toBe(15);
  });

  it("validates burn percentage bounds", async () => {
    const app = createApp();
    const response = await app.request("/economics/token/burn-rate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transactionVolume: 1_000_000,
        burnPercent: 101,
      }),
    });
    expect(response.status).toBe(400);
  });
});
