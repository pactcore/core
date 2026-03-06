import { describe, expect, it } from "bun:test";
import { decodeFunctionResult, functionSelectorFromSignature } from "../src/blockchain/abi-encoder";
import { createContainer } from "../src/application/container";
import { PactOnchain } from "../src/application/modules/pact-onchain";
import { createApp } from "../src/api/app";
import { MockEvmGovernanceBridge } from "../src/domain/governance-bridge";
import { MockEvmRewardsBridge } from "../src/domain/rewards-bridge";
import { MockRpcProvider } from "../src/infrastructure/blockchain/mock-rpc-provider";

const REWARDS_ADDRESS = "0x8888888888888888888888888888888888888888";

function decodeRawTxPayload(rawTx: unknown): { to: string; data: string } {
  if (typeof rawTx !== "string") {
    throw new Error(`Expected raw transaction as hex string, received ${typeof rawTx}`);
  }
  return JSON.parse(Buffer.from(rawTx.slice(2), "hex").toString("utf8")) as {
    to: string;
    data: string;
  };
}

function makeBridge(now: () => number, rpc = new MockRpcProvider()): MockEvmRewardsBridge {
  return new MockEvmRewardsBridge({
    contractAddress: REWARDS_ADDRESS,
    now,
    rpcProvider: rpc,
  });
}

describe("Rewards bridge", () => {
  it("syncEpochRewards sends aggregate calldata and stores participant allocations", async () => {
    let now = 1_000;
    const rpc = new MockRpcProvider();
    const bridge = makeBridge(() => now, rpc);

    const result = await bridge.syncEpochRewards({
      epoch: 7,
      distributions: [
        { participantId: "worker-1", amountCents: 1200 },
        { participantId: "worker-2", amountCents: 800 },
      ],
    });

    expect(result.participantCount).toBe(2);
    expect(result.totalAmountCents).toBe(2000);
    expect(result.txId).toBe("0xrewardtx-1");

    const sendCall = rpc.getCalls("eth_sendRawTransaction")[0];
    const payload = decodeRawTxPayload(sendCall?.params[0]);
    expect(payload.to).toBe(REWARDS_ADDRESS);
    expect(payload.data.slice(0, 10)).toBe(
      functionSelectorFromSignature("syncEpochRewards(uint256,uint256,uint256)"),
    );

    const [epoch, participantCount, totalAmount] = decodeFunctionResult(
      ["uint256", "uint256", "uint256"],
      `0x${payload.data.slice(10)}`,
    );
    expect(epoch).toBe(7n);
    expect(participantCount).toBe(2n);
    expect(totalAmount).toBe(2000n);
  });

  it("syncClaimStatus updates claimed and pending balances for a participant", async () => {
    let now = 1_000;
    const bridge = makeBridge(() => now);
    await bridge.syncEpochRewards({
      epoch: 8,
      distributions: [{ participantId: "worker-1", amountCents: 500 }],
    });
    await bridge.syncEpochRewards({
      epoch: 9,
      distributions: [{ participantId: "worker-1", amountCents: 700 }],
    });
    now = 2_000;

    const snapshot = await bridge.syncClaimStatus({
      participantId: "worker-1",
      claims: [{ epoch: 8, claimed: true, claimedAt: 1_500 }],
    });

    expect(snapshot.totalRewardsCents).toBe(1200);
    expect(snapshot.claimedRewardsCents).toBe(500);
    expect(snapshot.pendingRewardsCents).toBe(700);
    expect(snapshot.epochs[0]?.claimStatus).toBe("claimed");
    expect(snapshot.epochs[1]?.claimStatus).toBe("pending");
  });

  it("syncClaimStatus rejects claim updates for missing reward records", async () => {
    const bridge = makeBridge(() => 1_000);

    await expect(
      bridge.syncClaimStatus({
        participantId: "worker-404",
        claims: [{ epoch: 99, claimed: true }],
      }),
    ).rejects.toThrow("No reward found");
  });

  it("getParticipantRewards returns an empty snapshot when no rewards exist", async () => {
    const bridge = makeBridge(() => 1_000);
    const snapshot = await bridge.getParticipantRewards("worker-empty");

    expect(snapshot).toEqual({
      participantId: "worker-empty",
      totalRewardsCents: 0,
      claimedRewardsCents: 0,
      pendingRewardsCents: 0,
      epochs: [],
    });
  });

  it("syncClaimStatus emits aggregate claim calldata", async () => {
    let now = 1_000;
    const rpc = new MockRpcProvider();
    const bridge = makeBridge(() => now, rpc);
    await bridge.syncEpochRewards({
      epoch: 10,
      distributions: [{ participantId: "worker-1", amountCents: 900 }],
    });
    now = 2_000;

    await bridge.syncClaimStatus({
      participantId: "worker-1",
      claims: [{ epoch: 10, claimed: true }],
    });

    const sendCall = rpc.getCalls("eth_sendRawTransaction")[1];
    const payload = decodeRawTxPayload(sendCall?.params[0]);
    expect(payload.data.slice(0, 10)).toBe(
      functionSelectorFromSignature("syncClaimStatus(address,uint256,uint256)"),
    );

    const [, claimedEpochs, totalClaimed] = decodeFunctionResult(
      ["address", "uint256", "uint256"],
      `0x${payload.data.slice(10)}`,
    );
    expect(claimedEpochs).toBe(1n);
    expect(totalClaimed).toBe(900n);
  });

  it("API rewards endpoints distribute epoch rewards and read participant status", async () => {
    let now = 1_000;
    const container = createContainer();
    container.pactOnchain = new PactOnchain(
      new MockEvmGovernanceBridge({ now: () => now }),
      new MockEvmRewardsBridge({ now: () => now }),
    );
    const app = createApp(undefined, { container });

    const distributeResponse = await app.request("/rewards/epochs/11/distribute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        distributions: [
          { participantId: "worker-1", amountCents: 1100 },
          { participantId: "worker-2", amountCents: 400 },
        ],
      }),
    });
    expect(distributeResponse.status).toBe(201);
    const distribution = await distributeResponse.json() as { totalAmountCents: number };
    expect(distribution.totalAmountCents).toBe(1500);

    const participantResponse = await app.request("/rewards/worker-1");
    expect(participantResponse.status).toBe(200);
    const snapshot = await participantResponse.json() as {
      totalRewardsCents: number;
      pendingRewardsCents: number;
      epochs: Array<{ epoch: number; claimStatus: string }>;
    };
    expect(snapshot.totalRewardsCents).toBe(1100);
    expect(snapshot.pendingRewardsCents).toBe(1100);
    expect(snapshot.epochs).toHaveLength(1);
    expect(snapshot.epochs[0]).toMatchObject({
      epoch: 11,
      claimStatus: "pending",
    });
  });
});
