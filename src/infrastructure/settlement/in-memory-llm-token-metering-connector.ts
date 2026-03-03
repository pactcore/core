import type {
  LlmTokenMeteringConnector,
  SettlementConnectorRequest,
  SettlementConnectorResult,
} from "../../application/settlement-connectors";

export class InMemoryLlmTokenMeteringConnector implements LlmTokenMeteringConnector {
  private readonly balances = new Map<string, number>();

  async applyMeteringCredit(input: SettlementConnectorRequest): Promise<SettlementConnectorResult> {
    const nextBalance = (this.balances.get(input.payeeId) ?? 0) + input.amount;
    this.balances.set(input.payeeId, nextBalance);

    return {
      status: "applied",
      externalReference: `llm-metering-${input.recordId}`,
      processedAt: Date.now(),
      metadata: {
        accountId: input.payeeId,
        balance: String(nextBalance),
      },
    };
  }
}
