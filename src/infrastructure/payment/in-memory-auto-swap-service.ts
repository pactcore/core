/**
 * In-memory AutoSwapService — mirrors PactAutoSwap contract logic (§5.2).
 *
 * Uses configurable mock exchange rates and fee tiers for local/test use.
 * Production would plug in a real DEX router transport.
 */

import type {
  AutoSwapService,
  QuoteRequest,
  QuoteResult,
  SwapRequest,
  SwapResult,
  SwapRoute,
  SwapToEscrowRequest,
  SwapToEscrowResult,
} from "../../domain/auto-swap";
import { AutoSwapError } from "../../domain/auto-swap";

export interface MockExchangeRate {
  /** Price of 1 unit of tokenIn expressed in USDC smallest units */
  rateNumerator: bigint;
  rateDenominator: bigint;
}

export interface InMemoryAutoSwapServiceOptions {
  /** Default slippage tolerance in basis points (default 50 = 0.5%) */
  defaultSlippageBps?: number;
  /** Mock exchange rates per token (for testing) */
  mockRates?: Map<string, MockExchangeRate>;
  /** Callback when swap-to-escrow credits an escrow */
  onEscrowCredit?: (taskId: string, amountUsdc: bigint) => Promise<void>;
}

const MAX_SLIPPAGE_BPS = 2000; // 20%
const BPS_DENOMINATOR = 10_000n;

export class InMemoryAutoSwapService implements AutoSwapService {
  private defaultSlippageBps: number;
  private readonly routes = new Map<string, SwapRoute>();
  private readonly mockRates: Map<string, MockExchangeRate>;
  private readonly onEscrowCredit?: (taskId: string, amountUsdc: bigint) => Promise<void>;
  private readonly swapHistory: SwapResult[] = [];

  constructor(options: InMemoryAutoSwapServiceOptions = {}) {
    this.defaultSlippageBps = options.defaultSlippageBps ?? 50;
    this.mockRates = options.mockRates ?? new Map();
    this.onEscrowCredit = options.onEscrowCredit;
  }

  // ─── Core Operations ─────────────────────────────────────────────

  async swap(request: SwapRequest): Promise<SwapResult> {
    this.validateSwapInput(request.tokenIn, request.amountIn);

    const route = this.requireEnabledRoute(request.tokenIn);
    const quote = this.computeQuote(request.tokenIn, request.amountIn, route.poolFeeBps);

    if (quote.estimatedOut < request.minAmountOut) {
      throw new AutoSwapError(
        `Slippage exceeded: estimated ${quote.estimatedOut}, minimum ${request.minAmountOut}`,
        "SLIPPAGE_EXCEEDED",
      );
    }

    // Apply fee deduction (simulate pool fee)
    const amountOut = this.applyPoolFee(quote.estimatedOut, route.poolFeeBps);

    if (amountOut < request.minAmountOut) {
      throw new AutoSwapError(
        `Swap output ${amountOut} below minimum ${request.minAmountOut} after fees`,
        "SLIPPAGE_EXCEEDED",
      );
    }

    const result: SwapResult = {
      amountOut,
      ref: request.ref,
      executedAt: Date.now(),
      effectiveRate: this.calculateEffectiveRate(request.amountIn, amountOut),
    };

    this.swapHistory.push(result);
    return result;
  }

  async swapToEscrow(request: SwapToEscrowRequest): Promise<SwapToEscrowResult> {
    if (!request.taskId.trim()) {
      throw new AutoSwapError("taskId is required", "INVALID_AMOUNT");
    }

    const swapResult = await this.swap({
      tokenIn: request.tokenIn,
      amountIn: request.amountIn,
      minAmountOut: request.minAmountOut,
      ref: `escrow:${request.taskId}`,
    });

    let escrowCredited = false;
    if (this.onEscrowCredit) {
      await this.onEscrowCredit(request.taskId, swapResult.amountOut);
      escrowCredited = true;
    }

    return {
      ...swapResult,
      taskId: request.taskId,
      escrowCredited,
    };
  }

  async getQuote(request: QuoteRequest): Promise<QuoteResult> {
    this.validateSwapInput(request.tokenIn, request.amountIn);
    const route = this.requireEnabledRoute(request.tokenIn);
    return this.computeQuote(request.tokenIn, request.amountIn, route.poolFeeBps);
  }

  // ─── Route Management ────────────────────────────────────────────

  getRoute(tokenIn: string): SwapRoute | undefined {
    return this.routes.get(tokenIn.toLowerCase());
  }

  isTokenSupported(tokenIn: string): boolean {
    const route = this.routes.get(tokenIn.toLowerCase());
    return route !== undefined && route.enabled;
  }

  configureRoute(tokenIn: string, poolFeeBps: number, enabled: boolean): void {
    if (!tokenIn.trim()) {
      throw new AutoSwapError("tokenIn is required", "ZERO_ADDRESS");
    }
    if (poolFeeBps < 0 || poolFeeBps > 100_000) {
      throw new AutoSwapError("poolFeeBps out of range", "INVALID_AMOUNT");
    }

    const key = tokenIn.toLowerCase();
    this.routes.set(key, {
      tokenIn: key,
      poolFeeBps,
      enabled,
    });
  }

  setDefaultSlippageBps(bps: number): void {
    if (bps < 0 || bps > MAX_SLIPPAGE_BPS) {
      throw new AutoSwapError(
        `Slippage must be 0-${MAX_SLIPPAGE_BPS} bps`,
        "INVALID_AMOUNT",
      );
    }
    this.defaultSlippageBps = bps;
  }

  getDefaultSlippageBps(): number {
    return this.defaultSlippageBps;
  }

  listSupportedTokens(): string[] {
    return [...this.routes.entries()]
      .filter(([, route]) => route.enabled)
      .map(([key]) => key);
  }

  /** Get full swap history (for testing) */
  getSwapHistory(): readonly SwapResult[] {
    return this.swapHistory;
  }

  /** Set a mock exchange rate (for testing) */
  setMockRate(tokenIn: string, rateNumerator: bigint, rateDenominator: bigint): void {
    this.mockRates.set(tokenIn.toLowerCase(), { rateNumerator, rateDenominator });
  }

  // ─── Internal ─────────────────────────────────────────────────────

  private validateSwapInput(tokenIn: string, amountIn: bigint): void {
    if (!tokenIn.trim()) {
      throw new AutoSwapError("tokenIn is required", "ZERO_ADDRESS");
    }
    if (amountIn <= 0n) {
      throw new AutoSwapError("amountIn must be positive", "INVALID_AMOUNT");
    }
  }

  private requireEnabledRoute(tokenIn: string): SwapRoute {
    const key = tokenIn.toLowerCase();
    const route = this.routes.get(key);
    if (!route) {
      throw new AutoSwapError(`Token ${tokenIn} is not supported`, "TOKEN_NOT_SUPPORTED");
    }
    if (!route.enabled) {
      throw new AutoSwapError(`Route for ${tokenIn} is disabled`, "ROUTE_DISABLED");
    }
    return route;
  }

  private computeQuote(tokenIn: string, amountIn: bigint, poolFeeBps: number): QuoteResult {
    const key = tokenIn.toLowerCase();
    const rate = this.mockRates.get(key);

    let estimatedOut: bigint;
    if (rate) {
      estimatedOut = (amountIn * rate.rateNumerator) / rate.rateDenominator;
    } else {
      // Default: 1:1 rate
      estimatedOut = amountIn;
    }

    // Simulate price impact: larger swaps get slightly worse rates
    // Impact = amountIn / (amountIn + 1_000_000) in bps (simplified AMM model)
    const impactDenom = amountIn + 1_000_000n;
    const priceImpactBps = Number((amountIn * BPS_DENOMINATOR) / impactDenom);

    return {
      estimatedOut,
      poolFeeBps,
      priceImpactBps: Math.min(priceImpactBps, 10_000),
    };
  }

  private applyPoolFee(amount: bigint, feeBps: number): bigint {
    const feeAmount = (amount * BigInt(feeBps)) / BPS_DENOMINATOR;
    return amount - feeAmount;
  }

  private calculateEffectiveRate(amountIn: bigint, amountOut: bigint): string {
    if (amountIn === 0n) return "0";
    // Multiply by 1e18 for precision, then convert to float string
    const scaled = (amountOut * 1_000_000_000_000_000_000n) / amountIn;
    const intPart = scaled / 1_000_000_000_000_000_000n;
    const fracPart = scaled % 1_000_000_000_000_000_000n;
    const fracStr = fracPart.toString().padStart(18, "0").replace(/0+$/, "") || "0";
    return `${intPart}.${fracStr}`;
  }
}
