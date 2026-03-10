import type {
  ApiQuotaAllocationConnector,
  SettlementConnectorRequest,
  SettlementConnectorResult,
} from "../../application/settlement-connectors";
import {
  ExternalSettlementConnectorBase,
  type ExternalSettlementConnectorOptions,
} from "./external-settlement-connector-base";

export class ExternalApiQuotaAllocationConnector
  extends ExternalSettlementConnectorBase
  implements ApiQuotaAllocationConnector
{
  constructor(options: Omit<ExternalSettlementConnectorOptions, "connector" | "operation">) {
    super({
      ...options,
      connector: "api_quota_allocation",
      operation: "allocate_quota",
    });
  }

  async allocateQuota(input: SettlementConnectorRequest): Promise<SettlementConnectorResult> {
    return this.executeExternalSettlement(input, {
      quotaUnit: input.unit,
      quotaAmount: input.amount,
      consumerId: input.payeeId,
      allocatorId: input.payerId,
      assetId: input.assetId,
    });
  }
}
