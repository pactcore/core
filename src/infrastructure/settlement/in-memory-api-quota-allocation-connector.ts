import type {
  ApiQuotaAllocationConnector,
  SettlementConnectorRequest,
  SettlementConnectorResult,
} from "../../application/settlement-connectors";

export class InMemoryApiQuotaAllocationConnector implements ApiQuotaAllocationConnector {
  private readonly allocations = new Map<string, number>();

  async allocateQuota(input: SettlementConnectorRequest): Promise<SettlementConnectorResult> {
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
  }
}
