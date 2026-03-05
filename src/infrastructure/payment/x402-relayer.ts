import type { X402PaymentAdapter } from "../../application/contracts";
import {
  applyGasSponsorship,
  buildMetaTransaction,
  estimateMetaTransactionGas,
  normalizeRelayerConfig,
  type RelayerConfig,
  type SponsoredGasStats,
  type X402PaymentReceipt,
  type X402PaymentRequest,
  validateX402PaymentRequest,
} from "../../domain/x402-protocol";

export class X402Relayer {
  private readonly config: RelayerConfig;
  private readonly nonceBySender = new Map<string, number>();
  private readonly sponsoredGasByBeneficiary = new Map<string, SponsoredGasStats>();

  constructor(
    private readonly x402Adapter: X402PaymentAdapter,
    config: Partial<RelayerConfig> = {},
  ) {
    this.config = normalizeRelayerConfig(config);
  }

  async relay(tx: X402PaymentRequest): Promise<X402PaymentReceipt> {
    validateX402PaymentRequest(tx);

    const beneficiaryId = tx.beneficiaryId?.trim() ? tx.beneficiaryId : tx.from;
    const nonce = this.getCurrentNonce(tx.from);
    const gasUsed = this.estimateGas(tx);
    const metaTransaction = buildMetaTransaction(tx, nonce, gasUsed, this.config);
    const existingStats = this.sponsoredGasByBeneficiary.get(beneficiaryId);
    const sponsorship = applyGasSponsorship(
      beneficiaryId,
      gasUsed,
      existingStats?.sponsoredGasUsed ?? 0,
      tx.gasSponsored === true,
      this.config,
    );

    const paymentReceipt = await this.x402Adapter.transfer({
      from: tx.from,
      to: tx.to,
      amountCents: tx.amountCents,
      reference: tx.reference,
    });

    this.nonceBySender.set(tx.from, nonce + 1);
    if (sponsorship.gasSponsored) {
      this.sponsoredGasByBeneficiary.set(beneficiaryId, {
        beneficiaryId,
        sponsoredGasUsed: sponsorship.totalSponsoredGas,
        sponsoredTxCount: (existingStats?.sponsoredTxCount ?? 0) + 1,
        lastSponsoredAt: Date.now(),
      });
    }

    return {
      ...tx,
      beneficiaryId,
      gasSponsored: sponsorship.gasSponsored,
      gasUsed: sponsorship.gasUsed,
      gasCostCents: sponsorship.gasCostCents,
      txId: `x402_meta_${crypto.randomUUID()}`,
      paymentTxId: paymentReceipt.txId,
      relayedAt: Date.now(),
      metaTransaction,
    };
  }

  estimateGas(tx: Pick<X402PaymentRequest, "data">): number {
    return estimateMetaTransactionGas(tx, this.config);
  }

  getSponsoredGasStats(beneficiaryId: string): SponsoredGasStats {
    const normalizedBeneficiaryId = beneficiaryId.trim();
    if (!normalizedBeneficiaryId) {
      throw new Error("beneficiaryId is required");
    }

    const stats = this.sponsoredGasByBeneficiary.get(normalizedBeneficiaryId);
    if (!stats) {
      return {
        beneficiaryId: normalizedBeneficiaryId,
        sponsoredGasUsed: 0,
        sponsoredTxCount: 0,
      };
    }

    return { ...stats };
  }

  private getCurrentNonce(from: string): number {
    return this.nonceBySender.get(from) ?? 0;
  }
}
