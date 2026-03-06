import {
  MockEvmGovernanceBridge,
  type CreateGovernanceProposalInput,
  type ExecuteGovernanceProposalInput,
  type GovernanceProposal,
  type GovernanceVoteChoice,
  type VoteGovernanceProposalInput,
} from "../../domain/governance-bridge";
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
  ) {}

  async createGovernanceProposal(
    input: CreateGovernanceProposalInput,
  ): Promise<GovernanceProposal> {
    return this.governanceBridge.createProposal(input);
  }

  async voteGovernanceProposal(
    input: VoteGovernanceProposalInput,
  ): Promise<GovernanceProposal> {
    return this.governanceBridge.voteProposal(input);
  }

  async executeGovernanceProposal(
    input: ExecuteGovernanceProposalInput,
  ): Promise<GovernanceProposal> {
    return this.governanceBridge.executeProposal(input);
  }

  async syncEpochRewards(
    epoch: number,
    distributions: EpochRewardDistribution[],
  ): Promise<EpochRewardsSyncResult> {
    return this.rewardsBridge.syncEpochRewards({ epoch, distributions });
  }

  async syncRewardClaims(
    participantId: string,
    claims: RewardClaimUpdate[],
  ): Promise<ParticipantRewardsSnapshot> {
    return this.rewardsBridge.syncClaimStatus({ participantId, claims });
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
}
