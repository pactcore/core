export type DisputeStatus = "open" | "evidence" | "jury_vote" | "resolved" | "expired";

export type DisputeSubjectType = "mission" | "submission" | "evidence" | "verdict";

export type DisputeExpiryReason = "jury_timeout" | "liveness_failure";

export type CommitteeDecision = "approve" | "reject";

export interface DisputeEvidence {
  submitterId: string;
  description: string;
  artifactUris: string[];
  submittedAt: number;
}

export interface JuryVote {
  jurorId: string;
  vote: "uphold" | "reject";
  reasoning: string;
  votedAt: number;
}

export interface CommitteeVote {
  validatorId: string;
  decision: CommitteeDecision;
  reasoning: string;
  votedAt: number;
  weight: number;
  settlementRecipientId?: string;
}

export interface ValidatorAccount {
  validatorId: string;
  stakeCents: number;
  minStakeCents: number;
  reputation: number;
  settlementRecipientId?: string;
  available: boolean;
  pendingAssignments: number;
  consecutiveDisagreements: number;
  totalDisagreements: number;
  totalSlashAmountCents: number;
  stakedAt: number;
  lastUpdatedAt: number;
  unstakeRequestedAt?: number;
}

export interface CommitteeConfig {
  committeeSize: number;
  approvalThreshold: number;
  rejectionThreshold: number;
  reviewPeriodMs: number;
  minStakeCents: number;
  minValidatorReputation: number;
  requiredAttestations: number;
  optParamsHash?: string;
  slashOnDisagreementCount: number;
  slashAmountCents: number;
}

export interface CommitteeSelection {
  committeeId: string;
  missionId: string;
  validatorIds: string[];
  selectedAt: number;
  deadlineAt: number;
  optParamsHash?: string;
  attestationCount: number;
}

export interface CommitteeOutcome {
  decision: CommitteeDecision;
  decidedAt: number;
  reason: "threshold" | "deadline";
  approvingValidatorIds: string[];
  rejectingValidatorIds: string[];
  validatorRewardPayouts?: Record<string, number>;
}

export interface SettlementDistribution {
  totalAmountCents: number;
  providerAmountCents: number;
  validatorAmountCents: number;
  treasuryAmountCents: number;
  issuerAmountCents: number;
  providerRecipientId: string;
  treasuryRecipientId: string;
  issuerRecipientId: string;
  validatorPayouts: Record<string, number>;
}

export interface DisputeBondDistribution {
  challengerRefundCents: number;
  juryAmountCents: number;
  protocolAmountCents: number;
  penaltyAmountCents: number;
}

export type DisputeBondStatus = "escrowed" | "settled" | "refunded";

export interface DisputeBond {
  amountCents: number;
  assetId: string;
  unit: string;
  status: DisputeBondStatus;
  postedAt: number;
  releasedAt?: number;
  distribution?: DisputeBondDistribution;
}

export interface DisputeExpiry {
  evidenceDeadlineAt: number;
  votingDeadlineAt: number;
  expiredAt?: number;
  reason?: DisputeExpiryReason;
}

export interface DisputeVerdict {
  outcome: "upheld" | "rejected" | "split";
  penaltyBps: number;
  rewardDistribution: Record<string, number>;
  bondDistribution?: DisputeBondDistribution;
}

export interface DisputeCase {
  id: string;
  missionId: string;
  challengerId: string;
  respondentId: string;
  status: DisputeStatus;
  subjectType: DisputeSubjectType;
  subjectRef: string;
  evidenceHash: string;
  evidence: DisputeEvidence[];
  juryVotes: JuryVote[];
  bond: DisputeBond;
  expiry: DisputeExpiry;
  verdict?: DisputeVerdict;
  createdAt: number;
  openedAt: number;
  resolvedAt?: number;
  expiredAt?: number;
}

export interface DisputeConfig {
  jurySize: number;
  votingPeriodMs: number;
  evidencePeriodMs: number;
  minJuryReputation: number;
  minimumBondCents: number;
  bondPenaltyBps: number;
  bondJuryShareBps: number;
  protocolTreasuryId: string;
  bondEscrowId: string;
  bondAssetId: string;
  bondUnit: string;
}
