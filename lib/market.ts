"use client";

import { useQuery } from "@tanstack/react-query";
import { TOKENS, TOKEN_MAP } from "./tokens";
import { useTokenRegistry } from "./token-registry";
import type { MarketData, Token } from "./types";
import {
  getPriceHistory,
  type ChartRange,
  type PricePoint,
} from "./mock-data";

// Seed snapshot rendered until the first /api/prices fetch resolves.
// Same object on server and client → no hydration mismatch.
const SEED: Record<string, MarketData> = Object.fromEntries(
  TOKENS.map((t) => [
    t.symbol,
    {
      priceUsd: t.priceUsd,
      change24h: t.change24h,
      volume24h: t.volume24h,
      marketCap: t.marketCap,
      spark7d: [],
    },
  ]),
);

async function fetchPrices(): Promise<Record<string, MarketData>> {
  const res = await fetch("/api/prices");
  if (!res.ok) throw new Error("prices fetch failed");
  return res.json();
}

/** Live market data for all listed tokens, refreshed every 60s. */
export function useMarket(): Record<string, MarketData> {
  const { data } = useQuery({
    queryKey: ["prices"],
    queryFn: fetchPrices,
    refetchInterval: 60_000,
    staleTime: 30_000,
    placeholderData: SEED,
  });
  return data ?? SEED;
}

// Safe fallback for symbols missing from both live data and seeds
// (e.g. an admin-added token before its first price fetch).
const EMPTY_MARKET: MarketData = {
  priceUsd: 0,
  change24h: 0,
  volume24h: 0,
  marketCap: 0,
  spark7d: [],
};

/** Market data for a single token (seed values until live data arrives). */
export function useTokenMarket(symbol: string): MarketData {
  const market = useMarket();
  return market[symbol] ?? SEED[symbol] ?? EMPTY_MARKET;
}

/**
 * Admin-enabled tokens merged with live market data — for tables/lists.
 * Follows the admin swap-token list: disabled/delisted tokens drop out of
 * the market chart + table, admin-added customs appear (price $0 until a
 * feed exists).
 */
export function useMarketTokens(): (Token & MarketData)[] {
  const market = useMarket();
  const { enabled } = useTokenRegistry();
  return enabled.map((t) => ({ ...t, ...(market[t.symbol] ?? {}) }));
}

const RANGE_DAYS: Record<ChartRange, string> = {
  "1D": "1",
  "1W": "7",
  "1M": "30",
  "1Y": "365",
};

function tsLabel(ts: number, range: ChartRange): string {
  const d = new Date(ts);
  if (range === "1D")
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

async function fetchHistory(
  id: string,
  range: ChartRange,
): Promise<PricePoint[]> {
  const res = await fetch(`/api/history?id=${id}&days=${RANGE_DAYS[range]}`);
  if (!res.ok) throw new Error("history fetch failed");
  const json: { prices: [number, number][] } = await res.json();
  return json.prices.map(([ts, price], i) => ({
    t: i,
    label: tsLabel(ts, range),
    price: Number(price.toFixed(price < 1 ? 6 : 2)),
  }));
}

/**
 * Real price history for listed tokens (CoinGecko), deterministic mock
 * series for unlisted ones (IOI). Returns [] while live data loads.
 */
export function usePriceHistory(
  symbol: string,
  range: ChartRange,
): { data: PricePoint[]; isLoading: boolean } {
  const token = TOKEN_MAP[symbol];
  const id = token?.coingeckoId ?? null;
  // Live price for tokens without a CoinGecko feed (e.g. KANG, priced from its
  // on-chain pool) so the synthetic series is anchored to the real price.
  const livePrice = useMarket()[symbol]?.priceUsd;

  const { data, isLoading } = useQuery({
    queryKey: ["history", id, range],
    queryFn: () => fetchHistory(id!, range),
    enabled: !!id,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  if (!id)
    return {
      data: getPriceHistory(symbol, range, livePrice),
      isLoading: false,
    };
  return { data: data ?? [], isLoading };
}
