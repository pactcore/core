import type {
  CloudCreditBillingConnector,
  SettlementConnectorRequest,
  SettlementConnectorResult,
} from "../../application/settlement-connectors";
import {
  InMemorySettlementConnectorBase,
  type InMemorySettlementConnectorOptions,
} from "./in-memory-settlement-connector-base";

export class InMemoryCloudCreditBillingConnector
  extends InMemorySettlementConnectorBase
  implements CloudCreditBillingConnector
{
  private readonly balances = new Map<string, number>();

  constructor(options: InMemorySettlementConnectorOptions = {}) {
    super(options);
  }

  async applyBillingCredit(input: SettlementConnectorRequest): Promise<SettlementConnectorResult> {
    return this.executeWithResilience(input, () => {
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
    });
  }
}
