import { describe, expect, it } from "bun:test";
import { createApp } from "../src/api/app";
import { createContainer } from "../src/application/container";
import { PactOnchain } from "../src/application/modules/pact-onchain";
import { MockEvmGovernanceBridge } from "../src/domain/governance-bridge";
import { OnchainFinalityRuntime } from "../src/domain/onchain-finality";
import { MockEvmRewardsBridge } from "../src/domain/rewards-bridge";

describe("Onchain finality runtime", () => {
  it("tracks submitted, confirmed, and finalized onchain operations", async () => {
    let now = 100;
    const onchain = new PactOnchain(
      new MockEvmGovernanceBridge({ now: () => now }),
      new MockEvmRewardsBridge({ now: () => now }),
      new OnchainFinalityRuntime({ now: () => now, confirmationDepth: 2, finalityDepth: 4 }),
    );

    const proposal = await onchain.createGovernanceProposal({
      proposerId: "council-1",
      title: "Raise quorum visibility",
      description: "Track finality for governance writes",
      votingEndsAt: 200,
    });
    const rewards = await onchain.syncEpochRewards(7, [
      { participantId: "worker-1", amountCents: 2500 },
      { participantId: "worker-2", amountCents: 1250 },
    ]);

    expect(onchain.listTransactions({ status: "submitted" }).items).toHaveLength(2);

    onchain.recordTransactionInclusion(proposal.creationTxId, {
      blockNumber: 10,
      blockHash: "0xblock-10-a",
      includedAt: 110,
    });
    onchain.recordTransactionInclusion(rewards.txId, {
      blockNumber: 11,
      blockHash: "0xblock-11-a",
      includedAt: 111,
    });

    onchain.advanceHead(11, "0xblock-11-a");
    expect(onchain.getTransaction(proposal.creationTxId)?.status).toBe("confirmed");
    expect(onchain.getTransaction(rewards.txId)?.status).toBe("submitted");

    onchain.recordCanonicalBlock(12, "0xblock-12-a");
    const summary = onchain.advanceHead(13, "0xblock-13-a");

    expect(onchain.getTransaction(proposal.creationTxId)?.status).toBe("finalized");
    expect(onchain.getTransaction(proposal.creationTxId)?.confirmations).toBe(4);
    expect(onchain.getTransaction(rewards.txId)?.status).toBe("confirmed");
    expect(summary.finalizedCount).toBe(1);
    expect(summary.confirmedCount).toBe(1);
    expect(summary.headBlockNumber).toBe(13);
  });

  it("marks reorged transactions and exposes finality query APIs", async () => {
    let now = 200;
    const container = createContainer();
    container.pactOnchain = new PactOnchain(
      new MockEvmGovernanceBridge({ now: () => now }),
      new MockEvmRewardsBridge({ now: () => now }),
      new OnchainFinalityRuntime({ now: () => now, confirmationDepth: 1, finalityDepth: 2 }),
    );
    const app = createApp(undefined, { container });

    const createResponse = await app.request("/governance/proposals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proposerId: "council-2",
        title: "Finalize chain runtime",
        description: "Expose reorg-safe read models",
        quorum: 1,
        votingStartsAt: 200,
        votingEndsAt: 400,
      }),
    });
    expect(createResponse.status).toBe(201);

    const created = (await createResponse.json()) as {
      id: string;
      creationTxId: string;
    };

    container.pactOnchain.recordTransactionInclusion(created.creationTxId, {
      blockNumber: 20,
      blockHash: "0xblock-20-a",
      includedAt: 205,
    });
    container.pactOnchain.advanceHead(21, "0xblock-21-a");

    const summaryResponse = await app.request("/onchain/finality/summary");
    expect(summaryResponse.status).toBe(200);
    const summary = (await summaryResponse.json()) as {
      finalizedCount: number;
      trackedTransactionCount: number;
    };
    expect(summary.trackedTransactionCount).toBe(1);
    expect(summary.finalizedCount).toBe(1);

    const finalizedResponse = await app.request(
      `/onchain/finality/transactions?status=finalized&proposalId=${created.id}`,
    );
    expect(finalizedResponse.status).toBe(200);
    const finalizedPage = (await finalizedResponse.json()) as {
      items: Array<{ txId: string; status: string; operation: string }>;
    };
    expect(finalizedPage.items).toHaveLength(1);
    expect(finalizedPage.items[0]?.txId).toBe(created.creationTxId);
    expect(finalizedPage.items[0]?.operation).toBe("governance_proposal_create");

    container.pactOnchain.recordCanonicalBlock(20, "0xblock-20-b");

    const reorgedResponse = await app.request(`/onchain/finality/transactions/${created.creationTxId}`);
    expect(reorgedResponse.status).toBe(200);
    const reorged = (await reorgedResponse.json()) as {
      status: string;
      reorgedAt?: number;
      confirmations: number;
    };
    expect(reorged.status).toBe("reorged");
    expect(reorged.reorgedAt).toBeNumber();
    expect(reorged.confirmations).toBe(0);
  });

  it("ignores stale head regressions so finality state cannot roll backward", () => {
    let now = 300;
    const runtime = new OnchainFinalityRuntime({
      now: () => now,
      confirmationDepth: 1,
      finalityDepth: 2,
    });

    runtime.trackTransaction({
      txId: "0xtx-stale-head",
      operation: "governance_proposal_create",
      submittedAt: now,
      proposalId: "proposal-stale-head",
      referenceId: "proposal-stale-head",
    });
    runtime.recordTransactionInclusion({
      txId: "0xtx-stale-head",
      blockNumber: 30,
      blockHash: "0xblock-30-a",
      includedAt: now + 1,
    });

    const finalizedSummary = runtime.advanceHead(31, "0xblock-31-a");
    const beforeStale = runtime.getTransaction("0xtx-stale-head");

    now = 320;
    const staleSummary = runtime.advanceHead(29, "0xblock-29-a");
    const afterStale = runtime.getTransaction("0xtx-stale-head");

    expect(finalizedSummary.headBlockNumber).toBe(31);
    expect(beforeStale?.status).toBe("finalized");
    expect(beforeStale?.confirmations).toBe(2);
    expect(staleSummary.headBlockNumber).toBe(31);
    expect(afterStale?.status).toBe("finalized");
    expect(afterStale?.confirmations).toBe(2);
  });
});
