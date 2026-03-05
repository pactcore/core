import type {
  BlockchainGateway,
  CreditLineManager,
  GasSponsorshipManager,
  MicropaymentAggregator,
  PaymentReceipt,
  PaymentRouter,
  X402PaymentAdapter,
} from "../contracts";
import type {
  CreditLine,
  GasSponsorshipGrant,
  MicropaymentBatch,
  PaymentRoute,
} from "../../domain/payment-routing";
import type {
  SponsoredGasStats,
  X402PaymentReceipt,
} from "../../domain/x402-protocol";
import { PaymentSplitService } from "../../domain/payment-split";
import type { Task } from "../../domain/types";
import { InMemoryCreditLineManager } from "../../infrastructure/payment/in-memory-credit-line-manager";
import { InMemoryGasSponsorshipManager } from "../../infrastructure/payment/in-memory-gas-sponsorship-manager";
import { InMemoryMicropaymentAggregator } from "../../infrastructure/payment/in-memory-micropayment-aggregator";
import { InMemoryPaymentRouter } from "../../infrastructure/payment/in-memory-payment-router";
import type { X402Relayer } from "../../infrastructure/payment/x402-relayer";

export interface SettlementResult {
  blockchainTxId: string;
  receipts: PaymentReceipt[];
}

export class PactPay {
  private readonly splitter = new PaymentSplitService();
  private readonly paymentRouter: PaymentRouter;
  private readonly micropaymentAggregator: MicropaymentAggregator;
  private readonly creditLineManager: CreditLineManager;
  private readonly gasSponsorManager: GasSponsorshipManager;
  private readonly routeHistory = new Map<string, PaymentRoute>();

  constructor(
    private readonly blockchainGateway: BlockchainGateway,
    private readonly x402Adapter: X402PaymentAdapter,
    private readonly treasuryAccount = "treasury",
    paymentRouter?: PaymentRouter,
    micropaymentAggregator?: MicropaymentAggregator,
    creditLineManager?: CreditLineManager,
    gasSponsorManager?: GasSponsorshipManager,
    private readonly x402Relayer?: X402Relayer,
  ) {
    this.paymentRouter = paymentRouter ?? new InMemoryPaymentRouter();
    this.micropaymentAggregator = micropaymentAggregator ?? new InMemoryMicropaymentAggregator();
    this.creditLineManager = creditLineManager ?? new InMemoryCreditLineManager();
    this.gasSponsorManager = gasSponsorManager ?? new InMemoryGasSponsorshipManager();
  }

  async createEscrow(task: Task): Promise<void> {
    await this.blockchainGateway.createEscrow(task.id, task.issuerId, task.paymentCents);
  }

  async settle(task: Task): Promise<SettlementResult> {
    if (!task.assigneeId) {
      throw new Error(`Task ${task.id} has no assignee`);
    }

    const distribution = this.splitter.split(task.paymentCents, task.validatorIds);
    const payouts: Record<string, number> = {
      [task.assigneeId]: distribution.workerCents,
      [task.issuerId]: distribution.issuerCents,
      [this.treasuryAccount]: distribution.treasuryCents,
      ...distribution.validatorPayouts,
    };

    const blockchainTxId = await this.blockchainGateway.releaseEscrow(task.id, payouts);

    const receipts: PaymentReceipt[] = [];
    for (const [recipient, amountCents] of Object.entries(payouts)) {
      if (amountCents <= 0) {
        continue;
      }
      const receipt = await this.x402Adapter.transfer({
        from: `escrow:${task.id}`,
        to: recipient,
        amountCents,
        reference: task.id,
      });
      receipts.push(receipt);
    }

    return {
      blockchainTxId,
      receipts,
    };
  }

  async ledger(): Promise<PaymentReceipt[]> {
    return this.x402Adapter.ledger();
  }

  async relayPayment(
    from: string,
    to: string,
    amount: number,
    gasSponsored = false,
  ): Promise<X402PaymentReceipt> {
    if (!from.trim()) {
      throw new Error("from is required");
    }
    if (!to.trim()) {
      throw new Error("to is required");
    }

    const amountCents = Math.floor(amount);
    if (!Number.isFinite(amount) || amountCents <= 0) {
      throw new Error("amount must be a positive number");
    }

    const reference = `x402:relay:${crypto.randomUUID()}`;
    if (this.x402Relayer) {
      return this.x402Relayer.relay({
        from,
        to,
        amountCents,
        reference,
        beneficiaryId: from,
        gasSponsored,
      });
    }

    const paymentReceipt = await this.x402Adapter.transfer({
      from,
      to,
      amountCents,
      reference,
    });

    return {
      from,
      to,
      amountCents,
      reference,
      beneficiaryId: from,
      gasSponsored: false,
      gasUsed: 0,
      gasCostCents: 0,
      txId: `x402_meta_${crypto.randomUUID()}`,
      paymentTxId: paymentReceipt.txId,
      relayedAt: Date.now(),
      metaTransaction: {
        from,
        to,
        value: amountCents,
        data: `x402:${reference}`,
        nonce: 0,
        gasPrice: 0,
        gasLimit: 0,
        relayerSignature: "relayer_unavailable",
      },
    };
  }

  async getX402SponsoredGasStats(beneficiaryId: string): Promise<SponsoredGasStats> {
    if (this.x402Relayer) {
      return this.x402Relayer.getSponsoredGasStats(beneficiaryId);
    }

    const normalizedBeneficiaryId = beneficiaryId.trim();
    if (!normalizedBeneficiaryId) {
      throw new Error("beneficiaryId is required");
    }

    return {
      beneficiaryId: normalizedBeneficiaryId,
      sponsoredGasUsed: 0,
      sponsoredTxCount: 0,
    };
  }

  async routePayment(
    fromId: string,
    toId: string,
    amount: number,
    currency: string,
    reference: string,
  ): Promise<PaymentRoute> {
    const route = await this.paymentRouter.route(fromId, toId, amount, currency, reference);
    this.routeHistory.set(route.id, route);
    return route;
  }

  async listRoutes(): Promise<PaymentRoute[]> {
    if (hasRouteListing(this.paymentRouter)) {
      return this.paymentRouter.listRoutes();
    }
    return [...this.routeHistory.values()].map((route) => ({ ...route }));
  }

  async addMicropayment(payerId: string, payeeId: string, amountCents: number): Promise<void> {
    await this.micropaymentAggregator.addEntry(payerId, payeeId, amountCents);
  }

  async flushMicropayments(payerId: string): Promise<MicropaymentBatch> {
    const batch = await this.micropaymentAggregator.flush(payerId);
    for (const entry of batch.entries) {
      await this.routePayment(
        payerId,
        entry.payeeId,
        entry.amountCents,
        "USD_CENTS",
        `batch:${batch.id}`,
      );
    }
    return batch;
  }

  async openCreditLine(
    issuerId: string,
    borrowerId: string,
    limitCents: number,
    interestBps: number,
  ): Promise<CreditLine> {
    return this.creditLineManager.open(issuerId, borrowerId, limitCents, interestBps);
  }

  async useCreditLine(lineId: string, amountCents: number): Promise<CreditLine> {
    const line = await this.creditLineManager.use(lineId, amountCents);
    await this.routePayment(
      line.issuerId,
      line.borrowerId,
      amountCents,
      "USD_CENTS",
      `credit:${line.id}:use`,
    );
    return line;
  }

  async repayCreditLine(lineId: string, amountCents: number): Promise<CreditLine> {
    const line = await this.creditLineManager.repay(lineId, amountCents);
    await this.routePayment(
      line.borrowerId,
      line.issuerId,
      amountCents,
      "USD_CENTS",
      `credit:${line.id}:repay`,
    );
    return line;
  }

  async grantGasSponsorship(
    sponsorId: string,
    beneficiaryId: string,
    maxGasCents: number,
  ): Promise<GasSponsorshipGrant> {
    return this.gasSponsorManager.grant(sponsorId, beneficiaryId, maxGasCents);
  }

  async useGasSponsorship(grantId: string, gasCents: number): Promise<GasSponsorshipGrant> {
    const grant = await this.gasSponsorManager.useGas(grantId, gasCents);
    await this.routePayment(
      grant.sponsorId,
      grant.beneficiaryId,
      gasCents,
      "GAS_CENTS",
      `gas:${grant.id}`,
    );
    return grant;
  }
}

interface PaymentRouterWithListing extends PaymentRouter {
  listRoutes(): Promise<PaymentRoute[]>;
}

function hasRouteListing(router: PaymentRouter): router is PaymentRouterWithListing {
  return "listRoutes" in router && typeof router.listRoutes === "function";
}
