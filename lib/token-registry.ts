"use client";

import { useMemo } from "react";
import { TOKENS as BASE_TOKENS } from "./tokens";
import { NATIVE_SYMBOL } from "./chain";
import type { Token } from "./types";

/** A token is tradable if it has a contract address or is native XP. */
export function tokenTradable(t: Token | undefined): boolean {
  return !!t && (t.address !== null || t.symbol === NATIVE_SYMBOL);
}

export interface TokenRegistry {
  /** Every known token. */
  all: Token[];
  /** Alias of `all` — kept for callers written against the old admin-managed registry. */
  enabled: Token[];
  /** Tokens that are actually tradable (have an address / are XP). */
  tradable: Token[];
  /** symbol → Token. */
  map: Record<string, Token>;
}

/**
 * The static Xphere token registry. Formerly merged admin-added custom tokens
 * and honored admin enable/disable flags; the swap feature (and its admin
 * manager) was removed, so the static list is the whole registry now.
 */
export function useTokenRegistry(): TokenRegistry {
  return useMemo(() => {
    const all: Token[] = [...BASE_TOKENS];
    const tradable = all.filter(tokenTradable);
    const map: Record<string, Token> = Object.fromEntries(
      all.map((t) => [t.symbol, t]),
    );
    return { all, enabled: all, tradable, map };
  }, []);
}
