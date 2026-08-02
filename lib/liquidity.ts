"use client";

// Token-registry helpers shared by the admin pool tools (lib/pool-stats.ts).
// LP itself lives on PumpkinSwap — this app no longer adds/removes liquidity.
import { useMemo } from "react";
import { TOKEN_MAP } from "./tokens";
import { adminTokenToToken } from "./token-registry";
import { useDexStore } from "./store";
import { WNATIVE, NATIVE_SYMBOL } from "./chain";
import type { Token } from "./types";

/** Every known token incl. admin-added (and even delisted ones, so existing
 *  pools keep resolving). symbol → Token. */
export function useAllTokenMap(): Record<string, Token> {
  const adminTokens = useDexStore((s) => s.adminTokens);
  return useMemo(() => {
    const map: Record<string, Token> = { ...TOKEN_MAP };
    for (const a of adminTokens) {
      if (!map[a.symbol]) map[a.symbol] = adminTokenToToken(a);
    }
    return map;
  }, [adminTokens]);
}

/** Registry symbol → on-chain address (XP trades as WXP inside pairs). */
export function liquidityTokenAddress(
  symbol: string,
  map: Record<string, Token>,
): `0x${string}` | null {
  if (symbol === NATIVE_SYMBOL) return WNATIVE;
  return (map[symbol]?.address as `0x${string}` | null) ?? null;
}
