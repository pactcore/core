export type AuctionMechanism = "first_price" | "second_price" | "vickrey";

export interface AuctionBid {
  bidderId: string;
  taskId: string;
  bidCents: number;
  reputation: number;
  skills: string[];
  timestamp: number;
}

export interface AuctionResult {
  taskId: string;
  winnerId: string | null;
  winningBidCents: number | null;
  bids: AuctionBid[];
  mechanism: AuctionMechanism;
  resolvedAt: number;
}

export interface AuctionConfig {
  taskId: string;
  minimumReputation?: number;
}

function compareBids(a: AuctionBid, b: AuctionBid): number {
  if (b.bidCents !== a.bidCents) {
    return b.bidCents - a.bidCents;
  }

  if (b.reputation !== a.reputation) {
    return b.reputation - a.reputation;
  }

  if (a.timestamp !== b.timestamp) {
    return a.timestamp - b.timestamp;
  }

  return a.bidderId.localeCompare(b.bidderId);
}

function assertFinitePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertFiniteTimestamp(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("timestamp must be a positive number");
  }
}

abstract class BaseAuction {
  protected readonly bids: AuctionBid[] = [];
  protected readonly minimumReputation: number;
  protected readonly taskId: string;

  constructor(config: AuctionConfig) {
    this.taskId = config.taskId;
    this.minimumReputation = config.minimumReputation ?? 0;
    if (!Number.isFinite(this.minimumReputation) || this.minimumReputation < 0) {
      throw new Error("minimumReputation must be a non-negative number");
    }
  }

  submitBid(bid: AuctionBid): void {
    if (bid.taskId !== this.taskId) {
      throw new Error(`bid taskId ${bid.taskId} does not match auction taskId ${this.taskId}`);
    }

    assertFinitePositiveInteger(bid.bidCents, "bidCents");
    assertFiniteTimestamp(bid.timestamp);

    if (!Number.isFinite(bid.reputation) || bid.reputation < 0) {
      throw new Error("reputation must be a non-negative number");
    }

    this.bids.push({
      ...bid,
      skills: [...bid.skills],
    });
  }

  protected rankedEligibleBids(): AuctionBid[] {
    return this.bids
      .filter((bid) => bid.reputation >= this.minimumReputation)
      .slice()
      .sort(compareBids);
  }

  protected emptyResult(mechanism: AuctionMechanism): AuctionResult {
    return {
      taskId: this.taskId,
      winnerId: null,
      winningBidCents: null,
      bids: [],
      mechanism,
      resolvedAt: Date.now(),
    };
  }

  protected buildResult(
    mechanism: AuctionMechanism,
    rankedBids: AuctionBid[],
    winningBidCents: number,
  ): AuctionResult {
    const winner = rankedBids[0];
    if (!winner) {
      return this.emptyResult(mechanism);
    }

    return {
      taskId: this.taskId,
      winnerId: winner.bidderId,
      winningBidCents,
      bids: rankedBids,
      mechanism,
      resolvedAt: Date.now(),
    };
  }
}

export class VickreyAuction extends BaseAuction {
  resolve(): AuctionResult {
    const rankedBids = this.rankedEligibleBids();
    const winner = rankedBids[0];

    if (!winner) {
      return this.emptyResult("vickrey");
    }

    const secondBid = rankedBids[1];
    const winningBidCents = secondBid?.bidCents ?? winner.bidCents;
    return this.buildResult("vickrey", rankedBids, winningBidCents);
  }
}

export class FirstPriceAuction extends BaseAuction {
  resolve(): AuctionResult {
    const rankedBids = this.rankedEligibleBids();
    const winner = rankedBids[0];

    if (!winner) {
      return this.emptyResult("first_price");
    }

    return this.buildResult("first_price", rankedBids, winner.bidCents);
  }
}
