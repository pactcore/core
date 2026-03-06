import type {
  LlmTokenMeteringConnector,
  SettlementConnectorRequest,
  SettlementConnectorResult,
} from "../../application/settlement-connectors";
import {
  InMemorySettlementConnectorBase,
  type InMemorySettlementConnectorOptions,
} from "./in-memory-settlement-connector-base";

export class InMemoryLlmTokenMeteringConnector
  extends InMemorySettlementConnectorBase
  implements LlmTokenMeteringConnector
{
  private readonly balances = new Map<string, number>();

  constructor(options: InMemorySettlementConnectorOptions = {}) {
    super(options);
  }

  async applyMeteringCredit(input: SettlementConnectorRequest): Promise<SettlementConnectorResult> {
    return this.executeWithResilience(input, () => {
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
    });
  }
}
