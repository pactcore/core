export type DisputeStatus = "open" | "evidence" | "jury_vote" | "resolved";

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

export interface DisputeVerdict {
  outcome: "upheld" | "rejected" | "split";
  penaltyBps: number;
  rewardDistribution: Record<string, number>;
}

export interface DisputeCase {
  id: string;
  missionId: string;
  challengerId: string;
  respondentId: string;
  status: DisputeStatus;
  evidence: DisputeEvidence[];
  juryVotes: JuryVote[];
  verdict?: DisputeVerdict;
  createdAt: number;
  resolvedAt?: number;
}

export interface DisputeConfig {
  jurySize: number;
  votingPeriodMs: number;
  evidencePeriodMs: number;
  minJuryReputation: number;
}
