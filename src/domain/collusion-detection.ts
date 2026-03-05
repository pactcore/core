import type { AuctionBid, AuctionResult } from "./auction";

export interface CollusionSignal {
  type: "repeated_pairing" | "bid_clustering" | "timing_correlation";
  participantIds: string[];
  confidence: number;
  detectedAt: number;
}

export interface CollusionDetectorConfig {
  repeatedPairingThreshold: number;
  bidClusteringRangeCents: number;
  minBidsForClustering: number;
  timingWindowMs: number;
  minBidsForTimingCorrelation: number;
}

export interface CollusionCostAnalysis {
  controlCostPercent: number;
  expectedPenalty: number;
}

const DEFAULT_CONFIG: CollusionDetectorConfig = {
  repeatedPairingThreshold: 2,
  bidClusteringRangeCents: 20,
  minBidsForClustering: 3,
  timingWindowMs: 1_500,
  minBidsForTimingCorrelation: 3,
};

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return Math.round(value * 1000) / 1000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function uniqueParticipantIds(ids: string[]): string[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

function issuerFromTaskId(taskId: string): string {
  const separators = [":", "/", "|"];
  for (const separator of separators) {
    const index = taskId.indexOf(separator);
    if (index > 0) {
      return taskId.slice(0, index);
    }
  }
  return taskId;
}

function bidSpread(bids: AuctionBid[]): number {
  if (bids.length === 0) {
    return 0;
  }

  let min = bids[0]?.bidCents ?? 0;
  let max = min;

  for (const bid of bids) {
    if (bid.bidCents < min) {
      min = bid.bidCents;
    }
    if (bid.bidCents > max) {
      max = bid.bidCents;
    }
  }

  return max - min;
}

function findLargestTimingCluster(
  bids: AuctionBid[],
  timingWindowMs: number,
): { bids: AuctionBid[]; windowMs: number } {
  if (bids.length === 0) {
    return { bids: [], windowMs: 0 };
  }

  const sorted = bids.slice().sort((a, b) => a.timestamp - b.timestamp);

  let bestStart = 0;
  let bestEnd = 0;
  let start = 0;

  for (let end = 0; end < sorted.length; end += 1) {
    while ((sorted[end]?.timestamp ?? 0) - (sorted[start]?.timestamp ?? 0) > timingWindowMs) {
      start += 1;
    }

    if (end - start > bestEnd - bestStart) {
      bestStart = start;
      bestEnd = end;
    }
  }

  const cluster = sorted.slice(bestStart, bestEnd + 1);
  const windowMs = (cluster[cluster.length - 1]?.timestamp ?? 0) - (cluster[0]?.timestamp ?? 0);
  return { bids: cluster, windowMs };
}

export class CollusionDetector {
  private readonly config: CollusionDetectorConfig;

  constructor(config: Partial<CollusionDetectorConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  analyzeAuctionHistory(results: AuctionResult[]): CollusionSignal[] {
    const signals: CollusionSignal[] = [];
    signals.push(...this.detectRepeatedPairing(results));
    signals.push(...this.detectBidClustering(results));
    signals.push(...this.detectTimingCorrelation(results));
    return signals;
  }

  private detectRepeatedPairing(results: AuctionResult[]): CollusionSignal[] {
    const pairCounts = new Map<string, number>();
    const pairParticipants = new Map<string, string[]>();

    for (const result of results) {
      const issuerId = issuerFromTaskId(result.taskId);
      for (const bid of result.bids) {
        const key = `${bid.bidderId}::${bid.taskId}::${issuerId}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        pairParticipants.set(key, uniqueParticipantIds([bid.bidderId, issuerId]));
      }
    }

    const signals: CollusionSignal[] = [];
    for (const [key, count] of pairCounts.entries()) {
      if (count <= this.config.repeatedPairingThreshold) {
        continue;
      }

      const confidence = clamp01(
        0.55 + (count - this.config.repeatedPairingThreshold) / (this.config.repeatedPairingThreshold * 2),
      );

      signals.push({
        type: "repeated_pairing",
        participantIds: pairParticipants.get(key) ?? [],
        confidence,
        detectedAt: Date.now(),
      });
    }

    return signals;
  }

  private detectBidClustering(results: AuctionResult[]): CollusionSignal[] {
    const signals: CollusionSignal[] = [];

    for (const result of results) {
      if (result.bids.length < this.config.minBidsForClustering) {
        continue;
      }

      const spread = bidSpread(result.bids);
      if (spread > this.config.bidClusteringRangeCents) {
        continue;
      }

      const tightness =
        this.config.bidClusteringRangeCents === 0
          ? 1
          : 1 - spread / this.config.bidClusteringRangeCents;

      signals.push({
        type: "bid_clustering",
        participantIds: uniqueParticipantIds(result.bids.map((bid) => bid.bidderId)),
        confidence: clamp01(0.6 + tightness * 0.3),
        detectedAt: Date.now(),
      });
    }

    return signals;
  }

  private detectTimingCorrelation(results: AuctionResult[]): CollusionSignal[] {
    const signals: CollusionSignal[] = [];

    for (const result of results) {
      if (result.bids.length < this.config.minBidsForTimingCorrelation) {
        continue;
      }

      const cluster = findLargestTimingCluster(result.bids, this.config.timingWindowMs);
      if (cluster.bids.length < this.config.minBidsForTimingCorrelation) {
        continue;
      }

      const temporalTightness =
        this.config.timingWindowMs === 0 ? 1 : 1 - cluster.windowMs / this.config.timingWindowMs;

      signals.push({
        type: "timing_correlation",
        participantIds: uniqueParticipantIds(cluster.bids.map((bid) => bid.bidderId)),
        confidence: clamp01(0.55 + temporalTightness * 0.35),
        detectedAt: Date.now(),
      });
    }

    return signals;
  }
}

export function calculateCollusionCost(networkSize: number, colluders: number): CollusionCostAnalysis {
  if (!Number.isInteger(networkSize) || networkSize <= 0) {
    throw new Error("networkSize must be a positive integer");
  }
  if (!Number.isInteger(colluders) || colluders <= 0) {
    throw new Error("colluders must be a positive integer");
  }
  if (colluders > networkSize) {
    throw new Error("colluders cannot exceed networkSize");
  }

  // Cost rises super-linearly as colluders approach a controlling share.
  const collusionRatio = colluders / networkSize;
  const controlCostPercent = round2(Math.min(100, collusionRatio * collusionRatio * 100));
  const expectedPenalty = round2(controlCostPercent * colluders);

  return {
    controlCostPercent,
    expectedPenalty,
  };
}
