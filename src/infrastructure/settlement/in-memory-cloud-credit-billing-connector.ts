import type {
  CloudCreditBillingConnector,
  SettlementConnectorRequest,
  SettlementConnectorResult,
} from "../../application/settlement-connectors";

export class InMemoryCloudCreditBillingConnector implements CloudCreditBillingConnector {
  private readonly balances = new Map<string, number>();

  async applyBillingCredit(input: SettlementConnectorRequest): Promise<SettlementConnectorResult> {
    const nextBalance = (this.balances.get(input.payeeId) ?? 0) + input.amount;
    this.balances.set(input.payeeId, nextBalance);

    return {
      status: "applied",
      externalReference: `cloud-credit-${input.recordId}`,
      processedAt: Date.now(),
      metadata: {
        billingAccountId: input.payeeId,
        creditBalance: String(nextBalance),
      },
    };
  }
}
