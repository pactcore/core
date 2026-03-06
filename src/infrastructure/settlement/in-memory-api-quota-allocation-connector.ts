import type {
  ApiQuotaAllocationConnector,
  SettlementConnectorRequest,
  SettlementConnectorResult,
} from "../../application/settlement-connectors";
import {
  InMemorySettlementConnectorBase,
  type InMemorySettlementConnectorOptions,
} from "./in-memory-settlement-connector-base";

export class InMemoryApiQuotaAllocationConnector
  extends InMemorySettlementConnectorBase
  implements ApiQuotaAllocationConnector
{
  private readonly allocations = new Map<string, number>();

  constructor(options: InMemorySettlementConnectorOptions = {}) {
    super(options);
  }

  async allocateQuota(input: SettlementConnectorRequest): Promise<SettlementConnectorResult> {
    return this.executeWithResilience(input, () => {
      const nextQuota = (this.allocations.get(input.payeeId) ?? 0) + input.amount;
      this.allocations.set(input.payeeId, nextQuota);

      return {
        status: "applied",
        externalReference: `api-quota-${input.recordId}`,
        processedAt: Date.now(),
        metadata: {
          consumerId: input.payeeId,
          allocatedQuota: String(nextQuota),
        },
      };
    });
  }
}
