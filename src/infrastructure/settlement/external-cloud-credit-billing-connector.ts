import type {
  CloudCreditBillingConnector,
  SettlementConnectorRequest,
  SettlementConnectorResult,
} from "../../application/settlement-connectors";
import {
  ExternalSettlementConnectorBase,
  type ExternalSettlementConnectorOptions,
} from "./external-settlement-connector-base";

export class ExternalCloudCreditBillingConnector
  extends ExternalSettlementConnectorBase
  implements CloudCreditBillingConnector
{
  constructor(options: Omit<ExternalSettlementConnectorOptions, "connector" | "operation">) {
    super({
      ...options,
      connector: "cloud_credit_billing",
      operation: "apply_billing_credit",
    });
  }

  async applyBillingCredit(input: SettlementConnectorRequest): Promise<SettlementConnectorResult> {
    return this.executeExternalSettlement(input, {
      creditUnit: input.unit,
      creditAmount: input.amount,
      billingAccountId: input.payeeId,
      sponsorAccountId: input.payerId,
      assetId: input.assetId,
    });
  }
}
