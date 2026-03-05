import { describe, expect, it } from "bun:test";
import { createApp } from "../src/api/app";
import { PactPay } from "../src/application/modules/pact-pay";
import {
  applyGasSponsorship,
  buildMetaTransaction,
  estimateMetaTransactionGas,
  normalizeRelayerConfig,
} from "../src/domain/x402-protocol";
import { InMemoryBaseChainGateway } from "../src/infrastructure/blockchain/in-memory-base-chain-gateway";
import { InMemoryX402PaymentAdapter } from "../src/infrastructure/payment/in-memory-x402-payment-adapter";
import { X402Relayer } from "../src/infrastructure/payment/x402-relayer";

describe("X402 protocol", () => {
  it("estimates higher gas for larger calldata", () => {
    const config = normalizeRelayerConfig({
      baseGasLimit: 100,
      gasPerDataByte: 2,
    });
    const small = estimateMetaTransactionGas({ data: "ab" }, config);
    const large = estimateMetaTransactionGas({ data: "abcdef" }, config);

    expect(large).toBeGreaterThan(small);
  });

  it("builds a meta-transaction with relayer signature", () => {
    const config = normalizeRelayerConfig({
      relayerId: "relay-a",
      defaultGasPrice: 3,
    });
    const tx = buildMetaTransaction(
      {
        from: "alice",
        to: "bob",
        amountCents: 125,
        reference: "invoice-1",
      },
      7,
      30_000,
      config,
    );

    expect(tx.from).toBe("alice");
    expect(tx.to).toBe("bob");
    expect(tx.value).toBe(125);
    expect(tx.nonce).toBe(7);
    expect(tx.gasPrice).toBe(3);
    expect(tx.relayerSignature.startsWith("relayer_sig_")).toBeTrue();
  });

  it("rejects sponsorship above per-beneficiary cap", () => {
    const config = normalizeRelayerConfig({
      maxSponsoredGasPerBeneficiary: 50,
    });
    expect(() => applyGasSponsorship("alice", 40, 20, true, config)).toThrow(
      "Gas sponsorship limit exceeded",
    );
  });

  it("relays sponsored payments and tracks sponsored gas", async () => {
    const relayer = new X402Relayer(new InMemoryX402PaymentAdapter());
    const receipt = await relayer.relay({
      from: "payer-1",
      to: "payee-1",
      amountCents: 220,
      reference: "inv-1",
      gasSponsored: true,
    });

    expect(receipt.gasSponsored).toBeTrue();
    const stats = relayer.getSponsoredGasStats("payer-1");
    expect(stats.sponsoredTxCount).toBe(1);
    expect(stats.sponsoredGasUsed).toBe(receipt.gasUsed);
  });

  it("increments nonce across relayed meta-transactions", async () => {
    const relayer = new X402Relayer(new InMemoryX402PaymentAdapter());
    const first = await relayer.relay({
      from: "payer-2",
      to: "payee-1",
      amountCents: 100,
      reference: "inv-2",
    });
    const second = await relayer.relay({
      from: "payer-2",
      to: "payee-2",
      amountCents: 150,
      reference: "inv-3",
    });

    expect(first.metaTransaction.nonce).toBe(0);
    expect(second.metaTransaction.nonce).toBe(1);
  });

  it("uses X402 relayer from PactPay when available", async () => {
    const adapter = new InMemoryX402PaymentAdapter();
    const relayer = new X402Relayer(adapter);
    const pactPay = new PactPay(
      new InMemoryBaseChainGateway(),
      adapter,
      "treasury",
      undefined,
      undefined,
      undefined,
      undefined,
      relayer,
    );

    const receipt = await pactPay.relayPayment("beneficiary-1", "merchant-1", 400, true);
    const stats = await pactPay.getX402SponsoredGasStats("beneficiary-1");

    expect(receipt.gasSponsored).toBeTrue();
    expect(receipt.metaTransaction.from).toBe("beneficiary-1");
    expect(stats.sponsoredTxCount).toBe(1);
  });

  it("exposes relay and gas-stat endpoints", async () => {
    const app = createApp();
    const relayResponse = await app.request("/pay/x402/relay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: "beneficiary-2",
        to: "merchant-2",
        amountCents: 320,
        gasSponsored: true,
      }),
    });

    expect(relayResponse.status).toBe(201);
    const receipt = (await relayResponse.json()) as { gasSponsored: boolean };
    expect(receipt.gasSponsored).toBeTrue();

    const statsResponse = await app.request("/pay/x402/gas-stats/beneficiary-2");
    expect(statsResponse.status).toBe(200);
    const stats = (await statsResponse.json()) as {
      beneficiaryId: string;
      sponsoredTxCount: number;
      sponsoredGasUsed: number;
    };
    expect(stats.beneficiaryId).toBe("beneficiary-2");
    expect(stats.sponsoredTxCount).toBe(1);
    expect(stats.sponsoredGasUsed).toBeGreaterThan(0);
  });
});
