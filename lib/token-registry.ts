"use client";

import { useMemo } from "react";
import { TOKENS as BASE_TOKENS } from "./tokens";
import { NATIVE_SYMBOL } from "./chain";
import { useDexStore } from "./store";
import type { AdminToken, Token } from "./types";

/** Map an admin-added token into a full registry Token (mock market data). */
export function adminTokenToToken(a: AdminToken): Token {
  return {
    symbol: a.symbol,
    name: a.name,
    address: a.address,
    decimals: a.decimals,
    coingeckoId: null, // custom tokens have no CoinGecko listing
    priceUsd: 0,
    change24h: 0,
    volume24h: 0,
    marketCap: 0,
    color: a.color,
  };
}

/** A token is swappable if it has a contract address or is native XP. */
export function tokenTradable(t: Token | undefined): boolean {
  return !!t && (t.address !== null || t.symbol === NATIVE_SYMBOL);
}

export interface TokenRegistry {
  /** Every known token (static + admin), regardless of enabled state. */
  all: Token[];
  /** Tokens enabled for swapping (not disabled by admin). */
  enabled: Token[];
  /** Enabled tokens that are actually swappable (have an address / are XP). */
  tradable: Token[];
  /** symbol → Token, over `enabled`. */
  map: Record<string, Token>;
  /** symbols disabled by admin. */
  disabledSet: Set<string>;
}

/**
 * The effective token registry: the static Xphere registry merged with any
 * admin-added custom tokens, minus admin-disabled symbols. Drives the swap
 * token picker, quotes, and balances so admin changes take effect everywhere.
 */
export function useTokenRegistry(): TokenRegistry {
  const adminTokens = useDexStore((s) => s.adminTokens);
  const disabledTokens = useDexStore((s) => s.disabledTokens);
  const removedTokens = useDexStore((s) => s.removedTokens);

  return useMemo(() => {
    // Removed (delisted) tokens drop out of the registry entirely — they
    // disappear from every list until the admin restores them.
    const removedSet = new Set(removedTokens ?? []);
    const all: Token[] = BASE_TOKENS.filter((t) => !removedSet.has(t.symbol));
    for (const a of adminTokens) {
      if (!removedSet.has(a.symbol) && !all.some((t) => t.symbol === a.symbol)) {
        all.push(adminTokenToToken(a));
      }
    }
    const disabledSet = new Set(disabledTokens);
    const enabled = all.filter((t) => !disabledSet.has(t.symbol));
    const tradable = enabled.filter(tokenTradable);
    const map: Record<string, Token> = Object.fromEntries(
      enabled.map((t) => [t.symbol, t]),
    );
    return { all, enabled, tradable, map, disabledSet };
  }, [adminTokens, disabledTokens, removedTokens]);
}
