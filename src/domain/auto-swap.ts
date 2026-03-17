/**
 * Auto Swap domain types — mirrors PactAutoSwap contract (§5.2).
 *
 * Provides token-to-USDC swap routing with slippage protection,
 * quote estimation, and direct swap-to-escrow for task payments.
 */

// ─── Route Configuration ────────────────────────────────────────────

export interface SwapRoute {
  /** Token address / identifier */
  tokenIn: string;
  /** Pool fee tier in basis points (e.g. 3000 = 0.3%) */
  poolFeeBps: number;
  /** Whether the route is enabled */
  enabled: boolean;
}

// ─── Swap Request / Result ───────────────────────────────────────────

export interface SwapRequest {
  /** Token being swapped */
  tokenIn: string;
  /** Amount in smallest unit (wei / satoshi / etc.) */
  amountIn: bigint;
  /** Minimum acceptable output amount (slippage protection) */
  minAmountOut: bigint;
  /** Caller-defined reference for tracking */
  ref: string;
}

export interface SwapResult {
  /** Amount of USDC received */
  amountOut: bigint;
  /** Reference echoed back */
  ref: string;
  /** Timestamp of execution */
  executedAt: number;
  /** Effective exchange rate (amountOut / amountIn) as a float string */
  effectiveRate: string;
}

// ─── Swap-to-Escrow ──────────────────────────────────────────────────

export interface SwapToEscrowRequest {
  tokenIn: string;
  amountIn: bigint;
  minAmountOut: bigint;
  taskId: string;
}

export interface SwapToEscrowResult extends SwapResult {
  taskId: string;
  escrowCredited: boolean;
}

// ─── Quote ───────────────────────────────────────────────────────────

export interface QuoteRequest {
  tokenIn: string;
  amountIn: bigint;
}

export interface QuoteResult {
  estimatedOut: bigint;
  poolFeeBps: number;
  priceImpactBps: number;
}

// ─── Errors ──────────────────────────────────────────────────────────

export class AutoSwapError extends Error {
  constructor(
    message: string,
    public readonly code: AutoSwapErrorCode,
  ) {
    super(message);
    this.name = "AutoSwapError";
  }
}

export type AutoSwapErrorCode =
  | "TOKEN_NOT_SUPPORTED"
  | "INVALID_AMOUNT"
  | "SLIPPAGE_EXCEEDED"
  | "SWAP_FAILED"
  | "ROUTE_DISABLED"
  | "ZERO_ADDRESS";

// ─── Service Interface ──────────────────────────────────────────────

export interface AutoSwapService {
  /** Execute a token-to-USDC swap */
  swap(request: SwapRequest): Promise<SwapResult>;

  /** Swap tokens and credit output directly to a task escrow */
  swapToEscrow(request: SwapToEscrowRequest): Promise<SwapToEscrowResult>;

  /** Get a quote for a potential swap */
  getQuote(request: QuoteRequest): Promise<QuoteResult>;

  /** Get the configured route for a token */
  getRoute(tokenIn: string): SwapRoute | undefined;

  /** Check if a token is supported for swapping */
  isTokenSupported(tokenIn: string): boolean;

  /** Configure a swap route (admin) */
  configureRoute(tokenIn: string, poolFeeBps: number, enabled: boolean): void;

  /** Set default slippage tolerance in basis points */
  setDefaultSlippageBps(bps: number): void;

  /** Get default slippage tolerance */
  getDefaultSlippageBps(): number;

  /** List all supported tokens */
  listSupportedTokens(): string[];
}
