import type {
  LlmTokenMeteringConnector,
  SettlementConnectorRequest,
  SettlementConnectorResult,
} from "../../application/settlement-connectors";
import {
  ExternalSettlementConnectorBase,
  type ExternalSettlementConnectorOptions,
} from "./external-settlement-connector-base";

export class ExternalLlmTokenMeteringConnector
  extends ExternalSettlementConnectorBase
  implements LlmTokenMeteringConnector
{
  constructor(options: Omit<ExternalSettlementConnectorOptions, "connector" | "operation">) {
    super({
      ...options,
      connector: "llm_token_metering",
      operation: "apply_metering_credit",
    });
  }

  async applyMeteringCredit(input: SettlementConnectorRequest): Promise<SettlementConnectorResult> {
    return this.executeExternalSettlement(input, {
      billingUnit: input.unit,
      creditedAmount: input.amount,
      beneficiaryId: input.payeeId,
      payerAccountId: input.payerId,
      assetId: input.assetId,
    });
  }
}
