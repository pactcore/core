import { describe, expect, it } from "bun:test";
import { decodeFunctionResult, functionSelectorFromSignature } from "../src/blockchain/abi-encoder";
import { createContainer } from "../src/application/container";
import { PactOnchain } from "../src/application/modules/pact-onchain";
import { createApp } from "../src/api/app";
import {
  MockEvmGovernanceBridge,
  type CreateGovernanceProposalInput,
} from "../src/domain/governance-bridge";
import { MockEvmRewardsBridge } from "../src/domain/rewards-bridge";
import { MockRpcProvider } from "../src/infrastructure/blockchain/mock-rpc-provider";

const GOVERNANCE_ADDRESS = "0x7777777777777777777777777777777777777777";

function decodeRawTxPayload(rawTx: unknown): { to: string; data: string } {
  if (typeof rawTx !== "string") {
    throw new Error(`Expected raw transaction as hex string, received ${typeof rawTx}`);
  }
  return JSON.parse(Buffer.from(rawTx.slice(2), "hex").toString("utf8")) as {
    to: string;
    data: string;
  };
}

function makeBridge(now: () => number, rpc = new MockRpcProvider()): MockEvmGovernanceBridge {
  return new MockEvmGovernanceBridge({
    contractAddress: GOVERNANCE_ADDRESS,
    now,
    rpcProvider: rpc,
  });
}

function makeProposal(overrides: Partial<CreateGovernanceProposalInput> = {}): CreateGovernanceProposalInput {
  return {
    proposerId: "governor-alpha",
    title: "Upgrade treasury policy",
    description: "Increase validator subsidy cap",
    quorum: 2,
    votingStartsAt: 100,
    votingEndsAt: 200,
    actions: [
      {
        target: "treasury",
        signature: "setSubsidyCap(uint256)",
        calldata: "0x1234",
        value: 0,
      },
    ],
    ...overrides,
  };
}

describe("Governance bridge", () => {
  it("createProposal sends calldata and stores a deterministic proposal id", async () => {
    let now = 150;
    const rpc = new MockRpcProvider();
    const bridge = makeBridge(() => now, rpc);

    const proposal = await bridge.createProposal(makeProposal());
    expect(proposal.id).toBe("proposal-1");
    expect(proposal.status).toBe("active");
    expect(proposal.creationTxId).toBe("0xgovtx-1");

    const sendCall = rpc.getCalls("eth_sendRawTransaction")[0];
    const payload = decodeRawTxPayload(sendCall?.params[0]);
    expect(payload.to).toBe(GOVERNANCE_ADDRESS);
    expect(payload.data.slice(0, 10)).toBe(
      functionSelectorFromSignature(
        "createProposal(uint256,address,string,string,uint256,uint256,uint256,uint256)",
      ),
    );

    const [proposalId, proposer, title, description, startsAt, endsAt, quorum, actionCount] =
      decodeFunctionResult(
        ["uint256", "address", "string", "string", "uint256", "uint256", "uint256", "uint256"],
        `0x${payload.data.slice(10)}`,
      );
    expect(String(proposalId)).toMatch(/^\d+$/);
    expect(String(proposer)).toMatch(/^0x[0-9a-f]{40}$/);
    expect(title).toBe("Upgrade treasury policy");
    expect(description).toBe("Increase validator subsidy cap");
    expect(startsAt).toBe(100n);
    expect(endsAt).toBe(200n);
    expect(quorum).toBe(2n);
    expect(actionCount).toBe(1n);
  });

  it("voteProposal records for-votes and emits vote calldata", async () => {
    let now = 150;
    const rpc = new MockRpcProvider();
    const bridge = makeBridge(() => now, rpc);
    const created = await bridge.createProposal(makeProposal());

    const proposal = await bridge.voteProposal({
      proposalId: created.id,
      voterId: "validator-1",
      choice: "for",
      weight: 3,
    });

    expect(proposal.forVotes).toBe(3);
    expect(proposal.againstVotes).toBe(0);
    expect(proposal.votes).toHaveLength(1);
    expect(proposal.votes[0]?.txId).toBe("0xgovtx-2");

    const sendCall = rpc.getCalls("eth_sendRawTransaction")[1];
    const payload = decodeRawTxPayload(sendCall?.params[0]);
    expect(payload.data.slice(0, 10)).toBe(
      functionSelectorFromSignature("voteProposal(uint256,address,uint256,uint256)"),
    );

    const [, , choiceCode, weight] = decodeFunctionResult(
      ["uint256", "address", "uint256", "uint256"],
      `0x${payload.data.slice(10)}`,
    );
    expect(choiceCode).toBe(1n);
    expect(weight).toBe(3n);
  });

  it("rejects duplicate votes from the same participant", async () => {
    let now = 150;
    const bridge = makeBridge(() => now);
    const created = await bridge.createProposal(makeProposal());

    await bridge.voteProposal({ proposalId: created.id, voterId: "validator-1", choice: "for" });

    await expect(
      bridge.voteProposal({ proposalId: created.id, voterId: "validator-1", choice: "against" }),
    ).rejects.toThrow("already voted");
  });

  it("executeProposal succeeds after deadline when quorum and majority pass", async () => {
    let now = 150;
    const rpc = new MockRpcProvider();
    const bridge = makeBridge(() => now, rpc);
    const created = await bridge.createProposal(makeProposal());
    await bridge.voteProposal({ proposalId: created.id, voterId: "validator-1", choice: "for" });
    await bridge.voteProposal({ proposalId: created.id, voterId: "validator-2", choice: "for" });

    now = 250;
    const executed = await bridge.executeProposal({
      proposalId: created.id,
      executorId: "executor-1",
    });

    expect(executed.status).toBe("executed");
    expect(executed.executedBy).toBe("executor-1");
    expect(executed.executionTxId).toBe("0xgovtx-4");

    const sendCall = rpc.getCalls("eth_sendRawTransaction")[3];
    const payload = decodeRawTxPayload(sendCall?.params[0]);
    expect(payload.data.slice(0, 10)).toBe(
      functionSelectorFromSignature("executeProposal(uint256,address)"),
    );
  });

  it("executeProposal rejects defeated proposals after deadline", async () => {
    let now = 150;
    const bridge = makeBridge(() => now);
    const created = await bridge.createProposal(makeProposal());
    await bridge.voteProposal({ proposalId: created.id, voterId: "validator-1", choice: "against", weight: 2 });
    now = 250;

    await expect(
      bridge.executeProposal({ proposalId: created.id, executorId: "executor-1" }),
    ).rejects.toThrow("did not pass execution checks");

    const defeated = await bridge.getProposal(created.id);
    expect(defeated?.status).toBe("defeated");
  });

  it("listProposals returns proposals in creation order with lifecycle status", async () => {
    let now = 50;
    const bridge = makeBridge(() => now);
    await bridge.createProposal(makeProposal({ votingStartsAt: 100, votingEndsAt: 200 }));
    await bridge.createProposal(makeProposal({ votingStartsAt: 0, votingEndsAt: 25, title: "Already done" }));

    const proposals = await bridge.listProposals();
    expect(proposals.map((proposal) => proposal.id)).toEqual(["proposal-1", "proposal-2"]);
    expect(proposals[0]?.status).toBe("pending");
    expect(proposals[1]?.status).toBe("defeated");
  });

  it("API governance endpoints create, vote, and execute proposals", async () => {
    let now = 150;
    const container = createContainer();
    container.pactOnchain = new PactOnchain(
      new MockEvmGovernanceBridge({ now: () => now }),
      new MockEvmRewardsBridge({ now: () => now }),
    );
    const app = createApp(undefined, { container });

    const createResponse = await app.request("/governance/proposals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proposerId: "council-1",
        title: "Enable rewards sync",
        description: "Roll out epoch sync to production simulations",
        quorum: 1,
        votingStartsAt: 100,
        votingEndsAt: 200,
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as { id: string; status: string };
    expect(created.status).toBe("active");

    const voteResponse = await app.request(`/governance/proposals/${created.id}/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voterId: "delegate-1", support: true }),
    });
    expect(voteResponse.status).toBe(200);
    const voted = await voteResponse.json() as { forVotes: number };
    expect(voted.forVotes).toBe(1);

    now = 250;
    const executeResponse = await app.request(`/governance/proposals/${created.id}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ executorId: "multisig-1" }),
    });
    expect(executeResponse.status).toBe(200);
    const executed = await executeResponse.json() as { status: string; executedBy: string };
    expect(executed.status).toBe("executed");
    expect(executed.executedBy).toBe("multisig-1");
  });
});
