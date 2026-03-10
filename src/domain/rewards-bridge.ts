import { encodeFunction, functionSelectorFromSignature, keccak256Hex } from "../blockchain/abi-encoder";
import {
  normalizeLikeAddress,
  resolveTransactionSigner,
  submitSignedTransaction,
  type TransactionSigner,
} from "../blockchain/providers";
import {
  MockRpcProvider,
  type RpcProvider,
} from "../infrastructure/blockchain/mock-rpc-provider";

const DEFAULT_REWARDS_CONTRACT_ADDRESS = "0x6666666666666666666666666666666666666666";

export type RewardClaimStatus = "pending" | "claimed";

export interface EpochRewardDistribution {
  participantId: string;
  amountCents: number;
}

export interface ParticipantEpochReward {
  epoch: number;
  participantId: string;
  amountCents: number;
  claimStatus: RewardClaimStatus;
  syncedAt: number;
  claimedAt?: number;
}

export interface EpochRewardsSyncResult {
  epoch: number;
  participantCount: number;
  totalAmountCents: number;
  syncedAt: number;
  txId: string;
  rewards: ParticipantEpochReward[];
}

export interface RewardClaimUpdate {
  epoch: number;
  claimed: boolean;
  claimedAt?: number;
}

export interface ParticipantRewardsSnapshot {
  participantId: string;
  totalRewardsCents: number;
  claimedRewardsCents: number;
  pendingRewardsCents: number;
  epochs: ParticipantEpochReward[];
}

export interface SyncEpochRewardsInput {
  epoch: number;
  distributions: EpochRewardDistribution[];
}

export interface SyncRewardClaimStatusInput {
  participantId: string;
  claims: RewardClaimUpdate[];
}

export interface RewardsBridgeConfig {
  contractAddress?: string;
  signerPrivateKey?: string;
  signer?: TransactionSigner;
  rpcProvider?: RpcProvider;
  now?: () => number;
}

export class MockEvmRewardsBridge {
  private readonly rpcProvider: RpcProvider;
  private readonly signer: TransactionSigner;
  private readonly now: () => number;
  private readonly contractAddress: string;
  private readonly rewardsByEpoch = new Map<number, Map<string, ParticipantEpochReward>>();
  private lastClaimSyncTxId?: string;
  private txNonce = 0;
  private txCounter = 0;

  constructor(config: RewardsBridgeConfig = {}) {
    this.rpcProvider = config.rpcProvider ?? new MockRpcProvider();
    this.signer = resolveTransactionSigner(
      config.signer,
      config.signerPrivateKey,
      "pact-network-rewards-signer",
    );
    this.now = config.now ?? (() => Date.now());
    this.contractAddress = normalizeLikeAddress(
      config.contractAddress ?? DEFAULT_REWARDS_CONTRACT_ADDRESS,
    );

    if (this.rpcProvider instanceof MockRpcProvider) {
      this.rpcProvider.setMethodResponse("eth_sendRawTransaction", () => {
        this.txCounter += 1;
        return `0xrewardtx-${this.txCounter}`;
      });
    }
  }

  async syncEpochRewards(input: SyncEpochRewardsInput): Promise<EpochRewardsSyncResult> {
    const epoch = assertNonNegativeInteger(input.epoch, "epoch");
    const distributions = input.distributions.map((distribution, index) => normalizeDistribution(distribution, index));
    const syncedAt = this.now();
    const totalAmountCents = distributions.reduce((sum, distribution) => sum + distribution.amountCents, 0);
    const data = encodeFunction("syncEpochRewards", ["uint256", "uint256", "uint256"], [
      BigInt(epoch),
      BigInt(distributions.length),
      BigInt(totalAmountCents),
    ]);
    const txId = await this.sendRawTransaction(
      this.contractAddress,
      withSelector("syncEpochRewards(uint256,uint256,uint256)", data),
    );

    const epochRewards = this.rewardsByEpoch.get(epoch) ?? new Map<string, ParticipantEpochReward>();
    for (const distribution of distributions) {
      const existing = epochRewards.get(distribution.participantId);
      epochRewards.set(distribution.participantId, {
        epoch,
        participantId: distribution.participantId,
        amountCents: distribution.amountCents,
        claimStatus: existing?.claimStatus ?? "pending",
        syncedAt,
        claimedAt: existing?.claimedAt,
      });
    }
    this.rewardsByEpoch.set(epoch, epochRewards);

    return {
      epoch,
      participantCount: distributions.length,
      totalAmountCents,
      syncedAt,
      txId,
      rewards: this.getEpochRewardsSnapshot(epochRewards),
    };
  }

  async syncClaimStatus(input: SyncRewardClaimStatusInput): Promise<ParticipantRewardsSnapshot> {
    const participantId = assertNonEmptyString(input.participantId, "participantId");
    const claims = input.claims.map((claim, index) => normalizeClaimUpdate(claim, index));
    let claimedEpochCount = 0;
    let totalClaimedCents = 0;

    for (const claim of claims) {
      const epochRewards = this.rewardsByEpoch.get(claim.epoch);
      const reward = epochRewards?.get(participantId);
      if (!reward) {
        throw new Error(`No reward found for participant ${participantId} in epoch ${claim.epoch}`);
      }

      reward.claimStatus = claim.claimed ? "claimed" : "pending";
      reward.claimedAt = claim.claimed ? claim.claimedAt ?? this.now() : undefined;
      if (claim.claimed) {
        claimedEpochCount += 1;
        totalClaimedCents += reward.amountCents;
      }
    }

    const data = encodeFunction("syncClaimStatus", ["address", "uint256", "uint256"], [
      normalizeLikeAddress(participantId),
      BigInt(claimedEpochCount),
      BigInt(totalClaimedCents),
    ]);
    this.lastClaimSyncTxId = await this.sendRawTransaction(
      this.contractAddress,
      withSelector("syncClaimStatus(address,uint256,uint256)", data),
    );

    return this.getParticipantRewards(participantId);
  }

  async getParticipantRewards(participantId: string): Promise<ParticipantRewardsSnapshot> {
    const normalizedParticipantId = assertNonEmptyString(participantId, "participantId");
    const epochs: ParticipantEpochReward[] = [];
    for (const epochRewards of this.rewardsByEpoch.values()) {
      const reward = epochRewards.get(normalizedParticipantId);
      if (reward) {
        epochs.push({ ...reward });
      }
    }

    epochs.sort((left, right) => left.epoch - right.epoch);
    const totalRewardsCents = epochs.reduce((sum, reward) => sum + reward.amountCents, 0);
    const claimedRewardsCents = epochs
      .filter((reward) => reward.claimStatus === "claimed")
      .reduce((sum, reward) => sum + reward.amountCents, 0);

    return {
      participantId: normalizedParticipantId,
      totalRewardsCents,
      claimedRewardsCents,
      pendingRewardsCents: totalRewardsCents - claimedRewardsCents,
      epochs,
    };
  }

  private getEpochRewardsSnapshot(epochRewards: Map<string, ParticipantEpochReward>): ParticipantEpochReward[] {
    return [...epochRewards.values()].map((reward) => ({ ...reward }));
  }

  getLastClaimSyncTxId(): string | undefined {
    return this.lastClaimSyncTxId;
  }

  private async sendRawTransaction(to: string, data: string): Promise<string> {
    const nonce = this.txNonce;
    this.txNonce += 1;
    return submitSignedTransaction(this.rpcProvider, this.signer, {
      to,
      data,
      nonce,
    });
  }
}

function normalizeDistribution(
  distribution: EpochRewardDistribution,
  index: number,
): EpochRewardDistribution {
  return {
    participantId: assertNonEmptyString(distribution.participantId, `distributions[${index}].participantId`),
    amountCents: assertNonNegativeInteger(distribution.amountCents, `distributions[${index}].amountCents`),
  };
}

function normalizeClaimUpdate(claim: RewardClaimUpdate, index: number): RewardClaimUpdate {
  return {
    epoch: assertNonNegativeInteger(claim.epoch, `claims[${index}].epoch`),
    claimed: Boolean(claim.claimed),
    claimedAt:
      claim.claimedAt === undefined ? undefined : assertNonNegativeInteger(claim.claimedAt, `claims[${index}].claimedAt`),
  };
}

function withSelector(signature: string, encodedCall: string): string {
  const selector = functionSelectorFromSignature(signature);
  return `0x${selector.slice(2)}${encodedCall.slice(10)}`;
}

function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value.trim();
}

function assertNonNegativeInteger(value: unknown, fieldName: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return Number(value);
}
