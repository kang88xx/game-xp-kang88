"use client";

import { useMemo } from "react";
import { formatUnits, parseUnits } from "viem";
import { useReadContracts } from "wagmi";
import { TOKEN_MAP } from "./tokens";
import { CHAIN_ID, NATIVE_SYMBOL, PANCAKE_ROUTER, WNATIVE } from "./chain";
import { useTokenRegistry, tokenTradable } from "./token-registry";
import type { Token } from "./types";

// Our Uniswap-V2-fork Router02 + WXP — resolved in lib/chain.ts.
export { PANCAKE_ROUTER, WNATIVE };

/** Xphere DEX V2 LP fee (0.30% — the fork's UniswapV2Library uses mul(997)) */
export const PANCAKE_FEE = 0.003;

export const PANCAKE_ROUTER_ABI = [
  {
    type: "function",
    name: "getAmountsOut",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "path", type: "address[]" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "swapExactETHForTokens",
    stateMutability: "payable",
    inputs: [
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "swapExactTokensForETH",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "swapExactTokensForTokens",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

/** A token is swappable if it has a contract or is native XP. */
export function isTradable(symbol: string): boolean {
  return tokenTradable(TOKEN_MAP[symbol]);
}

/** Registry symbol → address used in router paths (XP → WXP). */
function pathAddress(
  symbol: string,
  map: Record<string, Token>,
): `0x${string}` | null {
  const t = map[symbol];
  if (!t) return null;
  if (t.symbol === NATIVE_SYMBOL) return WNATIVE;
  return t.address as `0x${string}` | null;
}

/**
 * Candidate router paths for a pair: the direct pair and (for token↔token)
 * the WXP hop. The quote hook asks for both and keeps the better one.
 * `map` is the effective token registry (static + admin tokens).
 */
export function buildPaths(
  fromSymbol: string,
  toSymbol: string,
  map: Record<string, Token>,
): `0x${string}`[][] {
  const a = pathAddress(fromSymbol, map);
  const b = pathAddress(toSymbol, map);
  if (!a || !b || a === b) return [];
  const paths: `0x${string}`[][] = [[a, b]];
  if (a !== WNATIVE && b !== WNATIVE) paths.push([a, WNATIVE, b]);
  return paths;
}

export interface SwapQuote {
  /** Best on-chain output for the entered amount (token units) */
  amountOut: number;
  amountOutWei: bigint;
  amountInWei: bigint;
  /** Router path that produced the best output */
  path: `0x${string}`[];
  isLoading: boolean;
  /** No route with liquidity exists for this pair */
  noRoute: boolean;
}

const EMPTY_QUOTE: SwapQuote = {
  amountOut: 0,
  amountOutWei: 0n,
  amountInWei: 0n,
  path: [],
  isLoading: false,
  noRoute: false,
};

/**
 * Live PumpkinSwap V2 quote — re-fetched every 15s and whenever the input
 * changes. `amountIn` must be the raw input string (decimal-safe).
 */
export function useSwapQuote(
  fromSymbol: string,
  toSymbol: string,
  amountIn: string,
): SwapQuote {
  const { map } = useTokenRegistry();
  const fromToken = map[fromSymbol];
  const toToken = map[toSymbol];

  let amountInWei = 0n;
  try {
    if (fromToken && amountIn && parseFloat(amountIn) > 0) {
      amountInWei = parseUnits(amountIn, fromToken.decimals);
    }
  } catch {
    amountInWei = 0n;
  }

  const paths = useMemo(
    () => buildPaths(fromSymbol, toSymbol, map),
    [fromSymbol, toSymbol, map],
  );

  const enabled = amountInWei > 0n && paths.length > 0;

  const { data, isLoading } = useReadContracts({
    contracts: paths.map((path) => ({
      address: PANCAKE_ROUTER,
      abi: PANCAKE_ROUTER_ABI,
      functionName: "getAmountsOut" as const,
      args: [amountInWei, path] as const,
      chainId: CHAIN_ID,
    })),
    query: { enabled, refetchInterval: 15_000 },
  });

  return useMemo(() => {
    if (!enabled) return EMPTY_QUOTE;
    if (!data) return { ...EMPTY_QUOTE, amountInWei, isLoading: true };

    let best: { out: bigint; path: `0x${string}`[] } | null = null;
    data.forEach((res, i) => {
      if (res.status !== "success") return; // pair doesn't exist → skip
      const amounts = res.result as readonly bigint[];
      const out = amounts[amounts.length - 1];
      if (!best || out > best.out) best = { out, path: paths[i] };
    });

    if (!best) {
      return { ...EMPTY_QUOTE, amountInWei, noRoute: true };
    }
    const { out, path } = best as { out: bigint; path: `0x${string}`[] };
    return {
      amountOut: Number(formatUnits(out, toToken.decimals)),
      amountOutWei: out,
      amountInWei,
      path,
      isLoading: isLoading,
      noRoute: false,
    };
  }, [enabled, data, isLoading, amountInWei, paths, toToken]);
}

/**
 * Hard math ceiling for slippage (percent) — NOT a UX cap. 100% makes bps =
 * 10_000, the largest value where (10_000n - bps) stays ≥ 0; anything above
 * would make minOut negative (unbounded loss). The custom field lets users
 * enter any value up to this; there is no lower "max" restriction.
 */
export const MAX_SLIPPAGE_PCT = 100;

/** amountOutMin after applying slippage (percent, e.g. 0.5) */
export function applySlippage(amountOutWei: bigint, slippagePct: number): bigint {
  // Clamp to [0, MAX_SLIPPAGE_PCT] and reject NaN so bps can never exceed
  // 10_000 (which would make 10_000n - bps negative → unbounded minOut loss).
  const safePct = Number.isFinite(slippagePct)
    ? Math.min(Math.max(slippagePct, 0), MAX_SLIPPAGE_PCT)
    : 0;
  const bps = BigInt(Math.round(safePct * 100)); // 0.5% → 50 bps
  return (amountOutWei * (10_000n - bps)) / 10_000n;
}

/** Swap deadline: now + 20 minutes (unix seconds) */
export function swapDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
}
