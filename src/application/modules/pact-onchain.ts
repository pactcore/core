import {
  MockEvmGovernanceBridge,
  type CreateGovernanceProposalInput,
  type ExecuteGovernanceProposalInput,
  type GovernanceProposal,
  type VoteGovernanceProposalInput,
} from "../../domain/governance-bridge";
import {
  OnchainFinalityRuntime,
  type OnchainFinalitySummary,
  type OnchainTransactionPage,
  type OnchainTransactionQuery,
  type OnchainTransactionRecord,
} from "../../domain/onchain-finality";
import {
  MockEvmRewardsBridge,
  type EpochRewardDistribution,
  type EpochRewardsSyncResult,
  type ParticipantRewardsSnapshot,
  type RewardClaimUpdate,
} from "../../domain/rewards-bridge";

export class PactOnchain {
  constructor(
    private readonly governanceBridge: MockEvmGovernanceBridge = new MockEvmGovernanceBridge(),
    private readonly rewardsBridge: MockEvmRewardsBridge = new MockEvmRewardsBridge(),
    private readonly finalityRuntime: OnchainFinalityRuntime = new OnchainFinalityRuntime(),
  ) {}

  async createGovernanceProposal(
    input: CreateGovernanceProposalInput,
  ): Promise<GovernanceProposal> {
    const proposal = await this.governanceBridge.createProposal(input);
    this.finalityRuntime.trackTransaction({
      txId: proposal.creationTxId,
      operation: "governance_proposal_create",
      submittedAt: proposal.createdAt,
      participantId: proposal.proposerId,
      proposalId: proposal.id,
      referenceId: proposal.id,
    });
    return proposal;
  }

  async voteGovernanceProposal(
    input: VoteGovernanceProposalInput,
  ): Promise<GovernanceProposal> {
    const proposal = await this.governanceBridge.voteProposal(input);
    const vote = proposal.votes[proposal.votes.length - 1];
    if (vote) {
      this.finalityRuntime.trackTransaction({
        txId: vote.txId,
        operation: "governance_proposal_vote",
        submittedAt: vote.castAt,
        participantId: vote.voterId,
        proposalId: proposal.id,
        referenceId: proposal.id,
      });
    }
    return proposal;
  }

  async executeGovernanceProposal(
    input: ExecuteGovernanceProposalInput,
  ): Promise<GovernanceProposal> {
    const proposal = await this.governanceBridge.executeProposal(input);
    if (proposal.executionTxId) {
      this.finalityRuntime.trackTransaction({
        txId: proposal.executionTxId,
        operation: "governance_proposal_execute",
        submittedAt: proposal.executedAt,
        participantId: proposal.executedBy,
        proposalId: proposal.id,
        referenceId: proposal.id,
      });
    }
    return proposal;
  }

  async syncEpochRewards(
    epoch: number,
    distributions: EpochRewardDistribution[],
  ): Promise<EpochRewardsSyncResult> {
    const result = await this.rewardsBridge.syncEpochRewards({ epoch, distributions });
    this.finalityRuntime.trackTransaction({
      txId: result.txId,
      operation: "rewards_epoch_sync",
      submittedAt: result.syncedAt,
      epoch: result.epoch,
      referenceId: `epoch-${result.epoch}`,
    });
    return result;
  }

  async syncRewardClaims(
    participantId: string,
    claims: RewardClaimUpdate[],
  ): Promise<ParticipantRewardsSnapshot> {
    const snapshot = await this.rewardsBridge.syncClaimStatus({ participantId, claims });
    const txId = this.rewardsBridge.getLastClaimSyncTxId();
    if (txId) {
      this.finalityRuntime.trackTransaction({
        txId,
        operation: "rewards_claim_sync",
        participantId,
        submittedAt: Date.now(),
        referenceId: participantId,
      });
    }
    return snapshot;
  }

  async getParticipantRewards(participantId: string): Promise<ParticipantRewardsSnapshot> {
    return this.rewardsBridge.getParticipantRewards(participantId);
  }

  getGovernanceBridge(): MockEvmGovernanceBridge {
    return this.governanceBridge;
  }

  getRewardsBridge(): MockEvmRewardsBridge {
    return this.rewardsBridge;
  }

  recordTransactionInclusion(
    txId: string,
    input: { blockNumber: number; blockHash: string; includedAt?: number },
  ): OnchainTransactionRecord {
    return this.finalityRuntime.recordTransactionInclusion({
      txId,
      blockNumber: input.blockNumber,
      blockHash: input.blockHash,
      includedAt: input.includedAt,
    });
  }

  recordCanonicalBlock(blockNumber: number, blockHash: string): void {
    this.finalityRuntime.recordCanonicalBlock({ blockNumber, blockHash });
  }

  advanceHead(blockNumber: number, blockHash?: string): OnchainFinalitySummary {
    return this.finalityRuntime.advanceHead(blockNumber, blockHash);
  }

  getTransaction(txId: string): OnchainTransactionRecord | undefined {
    return this.finalityRuntime.getTransaction(txId);
  }

  listTransactions(query: OnchainTransactionQuery = {}): OnchainTransactionPage {
    return this.finalityRuntime.listTransactions(query);
  }

  getFinalitySummary(): OnchainFinalitySummary {
    return this.finalityRuntime.getSummary();
  }

  getFinalityRuntime(): OnchainFinalityRuntime {
    return this.finalityRuntime;
  }
}
