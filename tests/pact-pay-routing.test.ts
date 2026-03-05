import { describe, expect, it } from "bun:test";
import { PactPay } from "../src/application/modules/pact-pay";
import { InMemoryBaseChainGateway } from "../src/infrastructure/blockchain/in-memory-base-chain-gateway";
import { InMemoryCreditLineManager } from "../src/infrastructure/payment/in-memory-credit-line-manager";
import { InMemoryGasSponsorshipManager } from "../src/infrastructure/payment/in-memory-gas-sponsorship-manager";
import { InMemoryMicropaymentAggregator } from "../src/infrastructure/payment/in-memory-micropayment-aggregator";
import { InMemoryPaymentRouter } from "../src/infrastructure/payment/in-memory-payment-router";
import { InMemoryX402PaymentAdapter } from "../src/infrastructure/payment/in-memory-x402-payment-adapter";

function createPactPay() {
  const paymentRouter = new InMemoryPaymentRouter();
  const micropaymentAggregator = new InMemoryMicropaymentAggregator();
  const creditLineManager = new InMemoryCreditLineManager();
  const gasSponsorshipManager = new InMemoryGasSponsorshipManager();
  const pactPay = new PactPay(
    new InMemoryBaseChainGateway(),
    new InMemoryX402PaymentAdapter(),
    "treasury",
    paymentRouter,
    micropaymentAggregator,
    creditLineManager,
    gasSponsorshipManager,
  );

  return {
    pactPay,
    creditLineManager,
    gasSponsorshipManager,
  };
}

describe("PactPay routing", () => {
  it("routes direct payments", async () => {
    const { pactPay } = createPactPay();
    const route = await pactPay.routePayment("payer-1", "payee-1", 1200, "USDC", "invoice-1");

    expect(route.status).toBe("completed");
    expect(route.routeType).toBe("direct");
    expect(route.fromId).toBe("payer-1");
    expect(route.toId).toBe("payee-1");
  });

  it("lists routed payments", async () => {
    const { pactPay } = createPactPay();
    const route = await pactPay.routePayment("payer-1", "payee-1", 550, "USDC", "invoice-2");

    const routes = await pactPay.listRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0]?.id).toBe(route.id);
  });

  it("marks invalid routes as failed", async () => {
    const { pactPay } = createPactPay();
    const route = await pactPay.routePayment("payer-1", "payee-1", 0, "USDC", "bad");

    expect(route.status).toBe("failed");
  });

  it("batches micropayments and computes totals on flush", async () => {
    const { pactPay } = createPactPay();
    await pactPay.addMicropayment("payer-1", "payee-1", 125);
    await pactPay.addMicropayment("payer-1", "payee-2", 300);

    const batch = await pactPay.flushMicropayments("payer-1");

    expect(batch.entries).toHaveLength(2);
    expect(batch.totalCents).toBe(425);
    expect(batch.settledAt).toBeDefined();
  });

  it("clears pending micropayments after flush", async () => {
    const { pactPay } = createPactPay();
    await pactPay.addMicropayment("payer-1", "payee-1", 125);
    await pactPay.flushMicropayments("payer-1");

    const secondFlush = await pactPay.flushMicropayments("payer-1");
    expect(secondFlush.entries).toHaveLength(0);
    expect(secondFlush.totalCents).toBe(0);
  });

  it("creates aggregated routes when flushing micropayments", async () => {
    const { pactPay } = createPactPay();
    await pactPay.addMicropayment("payer-1", "payee-1", 100);
    await pactPay.addMicropayment("payer-1", "payee-2", 200);
    const batch = await pactPay.flushMicropayments("payer-1");

    const routes = await pactPay.listRoutes();
    const aggregatedRoutes = routes.filter((route) => route.reference === `batch:${batch.id}`);
    expect(aggregatedRoutes).toHaveLength(2);
    expect(aggregatedRoutes.every((route) => route.routeType === "aggregated")).toBe(true);
  });

  it("opens, uses, and repays credit lines", async () => {
    const { pactPay } = createPactPay();
    const line = await pactPay.openCreditLine("issuer-1", "borrower-1", 1000, 250);

    const used = await pactPay.useCreditLine(line.id, 400);
    expect(used.usedCents).toBe(400);

    const repaid = await pactPay.repayCreditLine(line.id, 150);
    expect(repaid.usedCents).toBe(250);
  });

  it("rejects credit usage above limit", async () => {
    const { pactPay } = createPactPay();
    const line = await pactPay.openCreditLine("issuer-1", "borrower-1", 500, 250);

    await expect(pactPay.useCreditLine(line.id, 700)).rejects.toThrow("limit exceeded");
  });

  it("retrieves and lists credit lines by borrower", async () => {
    const { creditLineManager } = createPactPay();
    const line = await creditLineManager.open("issuer-1", "borrower-1", 1000, 200);
    await creditLineManager.open("issuer-1", "borrower-2", 2000, 200);

    const fetched = await creditLineManager.getLine(line.id);
    const borrowerLines = await creditLineManager.listByBorrower("borrower-1");

    expect(fetched?.id).toBe(line.id);
    expect(borrowerLines).toHaveLength(1);
    expect(borrowerLines[0]?.borrowerId).toBe("borrower-1");
  });

  it("grants and uses gas sponsorship", async () => {
    const { pactPay } = createPactPay();
    const grant = await pactPay.grantGasSponsorship("sponsor-1", "beneficiary-1", 100);
    const updated = await pactPay.useGasSponsorship(grant.id, 45);

    expect(updated.usedGasCents).toBe(45);
    expect(updated.maxGasCents).toBe(100);
  });

  it("rejects gas sponsorship exhaustion", async () => {
    const { pactPay } = createPactPay();
    const grant = await pactPay.grantGasSponsorship("sponsor-1", "beneficiary-1", 50);
    await pactPay.useGasSponsorship(grant.id, 40);

    await expect(pactPay.useGasSponsorship(grant.id, 20)).rejects.toThrow("exhausted");
  });

  it("tracks route status for completed and failed routes", async () => {
    const { pactPay } = createPactPay();
    const completed = await pactPay.routePayment("payer-1", "payee-1", 200, "USDC", "ok");
    const failed = await pactPay.routePayment("payer-1", "payee-1", -10, "USDC", "bad");

    const routes = await pactPay.listRoutes();
    const completedRoute = routes.find((route) => route.id === completed.id);
    const failedRoute = routes.find((route) => route.id === failed.id);

    expect(completedRoute?.status).toBe("completed");
    expect(failedRoute?.status).toBe("failed");
  });

  it("exposes gas grants through the manager contract", async () => {
    const { gasSponsorshipManager } = createPactPay();
    const grant = await gasSponsorshipManager.grant("sponsor-1", "beneficiary-1", 25);
    const fetched = await gasSponsorshipManager.getGrant(grant.id);

    expect(fetched?.id).toBe(grant.id);
    expect(fetched?.maxGasCents).toBe(25);
  });
});
