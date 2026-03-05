import { describe, expect, it } from "bun:test";
import { FirstPriceAuction, type AuctionBid, VickreyAuction } from "../src/domain/auction";

function createBid(
  bidderId: string,
  bidCents: number,
  overrides: Partial<Omit<AuctionBid, "bidderId" | "bidCents">> = {},
): AuctionBid {
  return {
    bidderId,
    taskId: "task-1",
    bidCents,
    reputation: 80,
    skills: ["vision"],
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

describe("Auction pricing", () => {
  it("resolves Vickrey auction where winner pays second-highest bid", () => {
    const auction = new VickreyAuction({ taskId: "task-1" });

    auction.submitBid(createBid("bidder-a", 1_500, { timestamp: 1_700_000_000_100 }));
    auction.submitBid(createBid("bidder-b", 1_200, { timestamp: 1_700_000_000_200 }));
    auction.submitBid(createBid("bidder-c", 900, { timestamp: 1_700_000_000_300 }));

    const result = auction.resolve();
    expect(result.winnerId).toBe("bidder-a");
    expect(result.winningBidCents).toBe(1_200);
    expect(result.mechanism).toBe("vickrey");
  });

  it("resolves first-price auction where winner pays own bid", () => {
    const auction = new FirstPriceAuction({ taskId: "task-1" });

    auction.submitBid(createBid("bidder-a", 1_500));
    auction.submitBid(createBid("bidder-b", 1_200));

    const result = auction.resolve();
    expect(result.winnerId).toBe("bidder-a");
    expect(result.winningBidCents).toBe(1_500);
    expect(result.mechanism).toBe("first_price");
  });

  it("filters out bidders below minimum reputation threshold", () => {
    const auction = new VickreyAuction({ taskId: "task-1", minimumReputation: 70 });

    auction.submitBid(createBid("low-rep", 2_000, { reputation: 40 }));
    auction.submitBid(createBid("eligible", 1_700, { reputation: 85 }));

    const result = auction.resolve();
    expect(result.winnerId).toBe("eligible");
    expect(result.bids.map((bid) => bid.bidderId)).toEqual(["eligible"]);
  });

  it("returns no winner when no eligible bids exist", () => {
    const auction = new VickreyAuction({ taskId: "task-1" });
    const result = auction.resolve();

    expect(result.winnerId).toBeNull();
    expect(result.winningBidCents).toBeNull();
    expect(result.bids).toEqual([]);
  });

  it("breaks ties by reputation when bids are equal", () => {
    const auction = new FirstPriceAuction({ taskId: "task-1" });

    auction.submitBid(createBid("rep-80", 1_000, { reputation: 80 }));
    auction.submitBid(createBid("rep-95", 1_000, { reputation: 95 }));

    const result = auction.resolve();
    expect(result.winnerId).toBe("rep-95");
    expect(result.winningBidCents).toBe(1_000);
  });

  it("breaks remaining ties by earliest timestamp", () => {
    const auction = new FirstPriceAuction({ taskId: "task-1" });

    auction.submitBid(createBid("earlier", 1_000, { reputation: 90, timestamp: 1_700_000_000_100 }));
    auction.submitBid(createBid("later", 1_000, { reputation: 90, timestamp: 1_700_000_000_200 }));

    const result = auction.resolve();
    expect(result.winnerId).toBe("earlier");
  });
});
