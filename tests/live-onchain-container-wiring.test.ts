import { describe, expect, it } from "bun:test";
import { MockRpcProvider, createContainer } from "../src";

describe("live onchain container wiring", () => {
  it("wires env-configured governance and rewards bridges through the container", async () => {
    const rpc = new MockRpcProvider();
    let txSequence = 0;
    rpc.setMethodResponse("eth_sendRawTransaction", () => {
      txSequence += 1;
      return `0xlive-bridge-${txSequence}`;
    });

    const container = createContainer(undefined, {
      env: {
        PACT_EVM_RPC_URL: "https://rpc.example.test",
        PACT_EVM_PRIVATE_KEY: "live-onchain-signer",
        PACT_GOVERNANCE_CONTRACT_ADDRESS: "0x7777777777777777777777777777777777777777",
        PACT_REWARDS_CONTRACT_ADDRESS: "0x8888888888888888888888888888888888888888",
        PACT_ONCHAIN_CONFIRMATION_DEPTH: "4",
        PACT_ONCHAIN_FINALITY_DEPTH: "9",
      },
      onchainRpcProvider: rpc,
    });

    const proposal = await container.pactOnchain.createGovernanceProposal({
      proposerId: "council-1",
      title: "Ship live governance bridge wiring",
      description: "Use env-backed onchain bridge configuration in the container runtime",
      votingEndsAt: Date.now() + 60_000,
    });
    const rewards = await container.pactOnchain.syncEpochRewards(12, [
      {
        participantId: "agent-7",
        amountCents: 2_500,
      },
    ]);

    const sendCalls = rpc.getCalls("eth_sendRawTransaction");
    expect(sendCalls).toHaveLength(2);
    expect(decodeSignedPayload(sendCalls[0]?.params[0]).to).toBe(
      "0x7777777777777777777777777777777777777777",
    );
    expect(decodeSignedPayload(sendCalls[1]?.params[0]).to).toBe(
      "0x8888888888888888888888888888888888888888",
    );
    expect(proposal.creationTxId).toBe("0xlive-bridge-1");
    expect(rewards.txId).toBe("0xlive-bridge-2");
    expect(container.pactOnchain.getFinalitySummary()).toMatchObject({
      submittedCount: 2,
      confirmationDepth: 4,
      finalityDepth: 9,
    });
    expect(container.pactOnchain.getTransaction(proposal.creationTxId)?.operation).toBe(
      "governance_proposal_create",
    );
    expect(container.pactOnchain.getTransaction(rewards.txId)?.operation).toBe("rewards_epoch_sync");
  });
});

function decodeSignedPayload(rawTx: unknown): { from: string; to: string; data: string; nonce: number } {
  if (typeof rawTx !== "string") {
    throw new Error(`Expected raw transaction as hex string, received ${typeof rawTx}`);
  }

  return JSON.parse(Buffer.from(rawTx.slice(2), "hex").toString("utf8")) as {
    from: string;
    to: string;
    data: string;
    nonce: number;
  };
}
