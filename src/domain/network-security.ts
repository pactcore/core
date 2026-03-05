export interface SybilResistanceInput {
  identityVerificationRate: number;
  averageStakeCents: number;
  minimumStakeCents: number;
}

export class SybilResistanceScore {
  static calculate(input: SybilResistanceInput): number {
    if (!Number.isFinite(input.averageStakeCents) || input.averageStakeCents < 0) {
      throw new Error("averageStakeCents must be a non-negative number");
    }
    if (!Number.isFinite(input.minimumStakeCents) || input.minimumStakeCents <= 0) {
      throw new Error("minimumStakeCents must be a positive number");
    }

    const identityScore = clamp01(input.identityVerificationRate);
    const stakeCoverage = clamp01(input.averageStakeCents / input.minimumStakeCents);
    const weighted = identityScore * 0.7 + stakeCoverage * 0.3;
    return Math.round(weighted * 100);
  }
}

export interface TimedTransaction {
  id: string;
  participantId: string;
  timestamp: number;
  referenceId?: string;
}

export interface FrontRunningAlert {
  leadingTransactionId: string;
  trailingTransactionId: string;
  participantIds: [string, string];
  deltaMs: number;
  confidence: number;
  referenceId?: string;
}

export interface FrontRunningDetectorConfig {
  suspiciousWindowMs: number;
  strictReferenceMatch: boolean;
}

const DEFAULT_FRONT_RUNNING_CONFIG: FrontRunningDetectorConfig = {
  suspiciousWindowMs: 1_000,
  strictReferenceMatch: true,
};

export class FrontRunningDetector {
  private readonly config: FrontRunningDetectorConfig;

  constructor(config: Partial<FrontRunningDetectorConfig> = {}) {
    this.config = {
      ...DEFAULT_FRONT_RUNNING_CONFIG,
      ...config,
    };
  }

  detect(transactions: TimedTransaction[]): FrontRunningAlert[] {
    const sorted = transactions
      .filter((transaction) => Number.isFinite(transaction.timestamp))
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp);

    const alerts: FrontRunningAlert[] = [];

    for (let i = 0; i < sorted.length; i += 1) {
      const leading = sorted[i];
      if (!leading) {
        continue;
      }

      for (let j = i + 1; j < sorted.length; j += 1) {
        const trailing = sorted[j];
        if (!trailing) {
          continue;
        }

        const deltaMs = trailing.timestamp - leading.timestamp;
        if (deltaMs > this.config.suspiciousWindowMs) {
          break;
        }

        if (deltaMs < 0 || leading.participantId === trailing.participantId) {
          continue;
        }

        const referenceId = leading.referenceId ?? trailing.referenceId;
        const sameReference =
          leading.referenceId !== undefined &&
          trailing.referenceId !== undefined &&
          leading.referenceId === trailing.referenceId;

        if (this.config.strictReferenceMatch && !sameReference) {
          continue;
        }

        if (!this.config.strictReferenceMatch && leading.referenceId && trailing.referenceId && !sameReference) {
          continue;
        }

        const confidenceBase = 1 - deltaMs / this.config.suspiciousWindowMs;
        const confidenceBoost = sameReference ? 0.15 : 0;
        const confidence = roundTo3(clamp01(confidenceBase + confidenceBoost));

        alerts.push({
          leadingTransactionId: leading.id,
          trailingTransactionId: trailing.id,
          participantIds: [leading.participantId, trailing.participantId],
          deltaMs,
          confidence,
          referenceId,
        });
      }
    }

    return alerts;
  }
}

export type NonceFailureReason = "invalid_nonce" | "replay_detected" | "nonce_gap";

export interface NonceVerificationResult {
  accepted: boolean;
  expectedNextNonce: number;
  reason?: NonceFailureReason;
}

export class ReplayAttackPrevention {
  private readonly latestNonceByParticipant = new Map<string, number>();

  verify(participantId: string, nonce: number): NonceVerificationResult {
    const latestNonce = this.latestNonceByParticipant.get(participantId);
    const expectedNonce = (latestNonce ?? -1) + 1;

    if (!Number.isInteger(nonce) || nonce < 0) {
      return {
        accepted: false,
        expectedNextNonce: expectedNonce,
        reason: "invalid_nonce",
      };
    }

    if (nonce < expectedNonce) {
      return {
        accepted: false,
        expectedNextNonce: expectedNonce,
        reason: "replay_detected",
      };
    }

    if (nonce > expectedNonce) {
      return {
        accepted: false,
        expectedNextNonce: expectedNonce,
        reason: "nonce_gap",
      };
    }

    this.latestNonceByParticipant.set(participantId, nonce);
    return {
      accepted: true,
      expectedNextNonce: nonce + 1,
    };
  }

  getLatestNonce(participantId: string): number | undefined {
    return this.latestNonceByParticipant.get(participantId);
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function roundTo3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
