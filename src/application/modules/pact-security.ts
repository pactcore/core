import type {
  AntiSpamActionRecord,
  AntiSpamRateLimitStore,
  DIDRepository,
  ParticipantStatsRepository,
} from "../contracts";
import { DEFAULT_STAKE_REQUIREMENTS } from "../../domain/anti-spam";
import {
  assessRisk,
  buildThreatModel,
  type SecurityAuditResult,
  type SecurityNetworkStats,
  type ThreatEntry,
} from "../../domain/security-threat-model";
import {
  ReplayAttackPrevention,
  SybilResistanceScore,
  type NonceVerificationResult,
} from "../../domain/network-security";

export interface PactSecurityOptions {
  participantStatsRepository?: ParticipantStatsRepository;
  didRepository?: DIDRepository;
  antiSpamRateLimitStore?: AntiSpamRateLimitStore;
  replayAttackPrevention?: ReplayAttackPrevention;
}

export interface SybilResistanceAssessment {
  participantId: string;
  score: number;
  identityVerificationRate: number;
  averageStakeCents: number;
  minimumStakeCents: number;
}

const BASE_MINIMUM_STAKE_CENTS = Math.max(
  DEFAULT_STAKE_REQUIREMENTS.task_creation.baseStakeCents,
  DEFAULT_STAKE_REQUIREMENTS.bid_submission.baseStakeCents,
  DEFAULT_STAKE_REQUIREMENTS.data_listing.baseStakeCents,
);

export class PactSecurity {
  private readonly replayAttackPrevention: ReplayAttackPrevention;

  constructor(private readonly options: PactSecurityOptions = {}) {
    this.replayAttackPrevention = options.replayAttackPrevention ?? new ReplayAttackPrevention();
  }

  runAudit(networkStats: SecurityNetworkStats): SecurityAuditResult {
    return assessRisk(networkStats);
  }

  getThreatModel(): ThreatEntry[] {
    return buildThreatModel();
  }

  async checkSybilResistance(participantId: string): Promise<SybilResistanceAssessment> {
    const stats = this.options.participantStatsRepository
      ? await this.options.participantStatsRepository.get(participantId)
      : undefined;
    const didDocument = this.options.didRepository
      ? await this.options.didRepository.getByParticipantId(participantId)
      : undefined;
    const antiSpamState = this.options.antiSpamRateLimitStore
      ? await this.options.antiSpamRateLimitStore.getParticipantState(participantId)
      : undefined;

    const verificationSignals = [
      didDocument !== undefined,
      stats?.hasIdVerification ?? false,
      stats?.hasPhoneVerification ?? false,
      stats?.hasZKProofOfHumanity ?? false,
    ];

    const identityVerificationRate =
      verificationSignals.filter(Boolean).length / verificationSignals.length;
    const averageStakeCents = calculateAverageStake(antiSpamState?.actions ?? []);
    const minimumStakeCents = calculateMinimumStake(antiSpamState?.actions ?? []);
    const score = SybilResistanceScore.calculate({
      identityVerificationRate,
      averageStakeCents,
      minimumStakeCents,
    });

    return {
      participantId,
      score,
      identityVerificationRate: roundTo3(identityVerificationRate),
      averageStakeCents,
      minimumStakeCents,
    };
  }

  verifyNonce(participantId: string, nonce: number): NonceVerificationResult {
    return this.replayAttackPrevention.verify(participantId, nonce);
  }
}

function calculateAverageStake(actions: AntiSpamActionRecord[]): number {
  if (actions.length === 0) {
    return 0;
  }

  const total = actions.reduce((sum, action) => sum + action.stakeCents, 0);
  return Math.round(total / actions.length);
}

function calculateMinimumStake(actions: AntiSpamActionRecord[]): number {
  if (actions.length === 0) {
    return BASE_MINIMUM_STAKE_CENTS;
  }

  const requiredFromHistory = actions.reduce((maxStake, action) => Math.max(maxStake, action.stakeCents), 0);
  return Math.max(BASE_MINIMUM_STAKE_CENTS, requiredFromHistory);
}

function roundTo3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
