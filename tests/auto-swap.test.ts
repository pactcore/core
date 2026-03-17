import { describe, expect, it, beforeEach } from "bun:test";
import { InMemoryAutoSwapService } from "../src/infrastructure/payment/in-memory-auto-swap-service";
import { AutoSwapError } from "../src/domain/auto-swap";

describe("InMemoryAutoSwapService", () => {
  let svc: InMemoryAutoSwapService;

  beforeEach(() => {
    svc = new InMemoryAutoSwapService({ defaultSlippageBps: 50 });
    // Configure WETH route: 3000 bps (0.3%) fee
    svc.configureRoute("0xWETH", 3000, true);
    // 1 WETH = 2000 USDC (rate: 2000/1)
    svc.setMockRate("0xWETH", 2000n, 1n);
  });

  // ─── Route Management ─────────────────────────────────────────────

  describe("route management", () => {
    it("configures and retrieves a route", () => {
      const route = svc.getRoute("0xWETH");
      expect(route).toBeDefined();
      expect(route!.poolFeeBps).toBe(3000);
      expect(route!.enabled).toBe(true);
    });

    it("is case-insensitive for token addresses", () => {
      svc.configureRoute("0xDAI", 500, true);
      expect(svc.getRoute("0xdai")).toBeDefined();
      expect(svc.isTokenSupported("0xDai")).toBe(true);
    });

    it("returns undefined for unconfigured tokens", () => {
      expect(svc.getRoute("0xUNKNOWN")).toBeUndefined();
    });

    it("lists only enabled tokens", () => {
      svc.configureRoute("0xDAI", 500, true);
      svc.configureRoute("0xDISABLED", 100, false);
      const tokens = svc.listSupportedTokens();
      expect(tokens).toContain("0xweth");
      expect(tokens).toContain("0xdai");
      expect(tokens).not.toContain("0xdisabled");
    });

    it("rejects empty tokenIn", () => {
      expect(() => svc.configureRoute("", 500, true)).toThrow(AutoSwapError);
    });

    it("rejects out-of-range poolFeeBps", () => {
      expect(() => svc.configureRoute("0xDAI", -1, true)).toThrow(AutoSwapError);
      expect(() => svc.configureRoute("0xDAI", 200_000, true)).toThrow(AutoSwapError);
    });
  });

  // ─── Slippage Config ──────────────────────────────────────────────

  describe("slippage config", () => {
    it("gets and sets default slippage", () => {
      expect(svc.getDefaultSlippageBps()).toBe(50);
      svc.setDefaultSlippageBps(100);
      expect(svc.getDefaultSlippageBps()).toBe(100);
    });

    it("rejects slippage above max", () => {
      expect(() => svc.setDefaultSlippageBps(3000)).toThrow(AutoSwapError);
    });

    it("rejects negative slippage", () => {
      expect(() => svc.setDefaultSlippageBps(-1)).toThrow(AutoSwapError);
    });
  });

  // ─── Quotes ───────────────────────────────────────────────────────

  describe("getQuote", () => {
    it("returns estimated output based on mock rate", async () => {
      const quote = await svc.getQuote({ tokenIn: "0xWETH", amountIn: 1n });
      expect(quote.estimatedOut).toBe(2000n);
      expect(quote.poolFeeBps).toBe(3000);
    });

    it("scales with amount", async () => {
      const quote = await svc.getQuote({ tokenIn: "0xWETH", amountIn: 5n });
      expect(quote.estimatedOut).toBe(10000n);
    });

    it("computes price impact", async () => {
      const smallQuote = await svc.getQuote({ tokenIn: "0xWETH", amountIn: 1n });
      const bigQuote = await svc.getQuote({ tokenIn: "0xWETH", amountIn: 1_000_000n });
      // Larger swaps should have higher price impact
      expect(bigQuote.priceImpactBps).toBeGreaterThan(smallQuote.priceImpactBps);
    });

    it("rejects unsupported token", async () => {
      await expect(svc.getQuote({ tokenIn: "0xNOPE", amountIn: 1n })).rejects.toThrow(
        AutoSwapError,
      );
    });

    it("rejects zero amount", async () => {
      await expect(svc.getQuote({ tokenIn: "0xWETH", amountIn: 0n })).rejects.toThrow(
        AutoSwapError,
      );
    });

    it("rejects disabled route", async () => {
      svc.configureRoute("0xDISABLED", 500, false);
      await expect(
        svc.getQuote({ tokenIn: "0xDISABLED", amountIn: 1n }),
      ).rejects.toThrow(AutoSwapError);
    });
  });

  // ─── Swap ─────────────────────────────────────────────────────────

  describe("swap", () => {
    it("executes a valid swap with fee deduction", async () => {
      // 1 WETH → 2000 USDC, with 30% pool fee → 1400 USDC
      const result = await svc.swap({
        tokenIn: "0xWETH",
        amountIn: 1n,
        minAmountOut: 1000n,
        ref: "test-ref-1",
      });
      expect(result.amountOut).toBe(1400n); // 2000 - 30% fee
      expect(result.ref).toBe("test-ref-1");
      expect(result.executedAt).toBeGreaterThan(0);
      expect(result.effectiveRate).toBeDefined();
    });

    it("records swap in history", async () => {
      await svc.swap({
        tokenIn: "0xWETH",
        amountIn: 1n,
        minAmountOut: 0n,
        ref: "hist-1",
      });
      const history = svc.getSwapHistory();
      expect(history).toHaveLength(1);
      expect(history[0].ref).toBe("hist-1");
    });

    it("rejects when output below minimum (slippage)", async () => {
      // 1 WETH = 2000 USDC → after 30% fee = 1400; asking for 1500 → fail
      await expect(
        svc.swap({
          tokenIn: "0xWETH",
          amountIn: 1n,
          minAmountOut: 1500n,
          ref: "fail",
        }),
      ).rejects.toThrow(AutoSwapError);
    });

    it("uses 1:1 rate when no mock rate is set", async () => {
      svc.configureRoute("0xDAI", 100, true); // 1% fee
      const result = await svc.swap({
        tokenIn: "0xDAI",
        amountIn: 10000n,
        minAmountOut: 0n,
        ref: "dai-swap",
      });
      // 10000 - 1% = 9900
      expect(result.amountOut).toBe(9900n);
    });
  });

  // ─── Swap to Escrow ───────────────────────────────────────────────

  describe("swapToEscrow", () => {
    it("swaps and credits escrow", async () => {
      let creditedTaskId = "";
      let creditedAmount = 0n;
      svc = new InMemoryAutoSwapService({
        defaultSlippageBps: 50,
        onEscrowCredit: async (taskId, amount) => {
          creditedTaskId = taskId;
          creditedAmount = amount;
        },
      });
      svc.configureRoute("0xWETH", 3000, true);
      svc.setMockRate("0xWETH", 2000n, 1n);

      const result = await svc.swapToEscrow({
        tokenIn: "0xWETH",
        amountIn: 1n,
        minAmountOut: 0n,
        taskId: "task-42",
      });

      expect(result.taskId).toBe("task-42");
      expect(result.escrowCredited).toBe(true);
      expect(result.amountOut).toBe(1400n);
      expect(creditedTaskId).toBe("task-42");
      expect(creditedAmount).toBe(1400n);
    });

    it("marks escrowCredited=false when no callback", async () => {
      const result = await svc.swapToEscrow({
        tokenIn: "0xWETH",
        amountIn: 1n,
        minAmountOut: 0n,
        taskId: "task-99",
      });
      expect(result.escrowCredited).toBe(false);
    });

    it("rejects empty taskId", async () => {
      await expect(
        svc.swapToEscrow({
          tokenIn: "0xWETH",
          amountIn: 1n,
          minAmountOut: 0n,
          taskId: "",
        }),
      ).rejects.toThrow(AutoSwapError);
    });
  });

  // ─── Multiple Tokens ──────────────────────────────────────────────

  describe("multi-token", () => {
    beforeEach(() => {
      svc.configureRoute("0xDAI", 100, true); // 0.01% fee
      svc.setMockRate("0xDAI", 1n, 1n); // 1 DAI = 1 USDC
      svc.configureRoute("0xWBTC", 3000, true);
      svc.setMockRate("0xWBTC", 65000n, 1n); // 1 WBTC = 65000 USDC
    });

    it("handles DAI at near-parity", async () => {
      const result = await svc.swap({
        tokenIn: "0xDAI",
        amountIn: 100000n,
        minAmountOut: 99000n,
        ref: "dai",
      });
      // 100000 - 1% = 99000
      expect(result.amountOut).toBe(99000n);
    });

    it("handles WBTC at high rate", async () => {
      const result = await svc.swap({
        tokenIn: "0xWBTC",
        amountIn: 1n,
        minAmountOut: 40000n,
        ref: "btc",
      });
      // 65000 - 30% = 45500
      expect(result.amountOut).toBe(45500n);
    });

    it("lists all supported tokens", () => {
      const tokens = svc.listSupportedTokens();
      expect(tokens).toHaveLength(3);
      expect(tokens).toContain("0xweth");
      expect(tokens).toContain("0xdai");
      expect(tokens).toContain("0xwbtc");
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles very large amounts", async () => {
      const bigAmount = 1_000_000_000_000_000_000n; // 1e18
      const result = await svc.swap({
        tokenIn: "0xWETH",
        amountIn: bigAmount,
        minAmountOut: 0n,
        ref: "big",
      });
      expect(result.amountOut).toBeGreaterThan(0n);
    });

    it("effective rate string is valid", async () => {
      const result = await svc.swap({
        tokenIn: "0xWETH",
        amountIn: 100n,
        minAmountOut: 0n,
        ref: "rate",
      });
      const rate = parseFloat(result.effectiveRate);
      expect(Number.isFinite(rate)).toBe(true);
      expect(rate).toBeGreaterThan(0);
    });

    it("disabling a route prevents swaps", async () => {
      svc.configureRoute("0xWETH", 3000, false);
      await expect(
        svc.swap({ tokenIn: "0xWETH", amountIn: 1n, minAmountOut: 0n, ref: "x" }),
      ).rejects.toThrow(AutoSwapError);
    });

    it("re-enabling a route allows swaps again", async () => {
      svc.configureRoute("0xWETH", 3000, false);
      svc.configureRoute("0xWETH", 3000, true);
      const result = await svc.swap({
        tokenIn: "0xWETH",
        amountIn: 1n,
        minAmountOut: 0n,
        ref: "reenable",
      });
      expect(result.amountOut).toBeGreaterThan(0n);
    });
  });
});
