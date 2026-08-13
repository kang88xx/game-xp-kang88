import type { AirdropCampaign } from "./types";
import { TOKEN_MAP } from "./tokens";

// Token registry moved to lib/tokens.ts (Xphere). Re-exported here so existing
// imports keep working during the production transition.
export { TOKENS, TOKEN_MAP, getToken } from "./tokens";

// ------------------------------------------------------------------
//  Deterministic price-history generator (stable across SSR/CSR)
// ------------------------------------------------------------------

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PricePoint {
  t: number; // index / label
  label: string;
  price: number;
}

export type ChartRange = "1D" | "1W" | "1M" | "1Y";

const RANGE_POINTS: Record<ChartRange, number> = {
  "1D": 24,
  "1W": 28,
  "1M": 30,
  "1Y": 52,
};

/**
 * Build a deterministic price series ending at the token's current price.
 * Walks backwards from the present using the 24h change to set drift.
 */
export function getPriceHistory(
  symbol: string,
  range: ChartRange = "1M",
  // Live price override — for tokens with no CoinGecko feed (e.g. KANG) whose
  // real price comes from the on-chain pool, not the static token seed.
  currentPrice?: number,
): PricePoint[] {
  const token = TOKEN_MAP[symbol];
  if (!token) return [];
  const price =
    currentPrice != null && currentPrice > 0 ? currentPrice : token.priceUsd;
  const points = RANGE_POINTS[range];
  const rand = mulberry32(hashSeed(symbol + range));

  // stablecoins barely move
  const isStable = price > 0.95 && price < 1.05 && Math.abs(token.change24h) < 0.1;
  const vol = isStable ? 0.0008 : 0.045 + (hashSeed(symbol) % 30) / 1000;
  // overall drift so the series trends toward today's value
  const drift = (token.change24h / 100) * (range === "1D" ? 1 : range === "1W" ? 2.2 : range === "1M" ? 4 : 9);

  const series: number[] = [];
  let p = price / (1 + drift);
  for (let i = 0; i < points; i++) {
    const noise = (rand() - 0.5) * 2 * vol;
    const stepDrift = drift / points;
    p = p * (1 + stepDrift + noise);
    series.push(p);
  }
  // pin the last point to the real current price
  series[series.length - 1] = price;

  return series.map((price, i) => ({
    t: i,
    label: rangeLabel(range, i, points),
    price: Number(price.toFixed(price < 1 ? 6 : 2)),
  }));
}

function rangeLabel(range: ChartRange, i: number, points: number): string {
  if (range === "1D") return `${i}:00`;
  const daysBack = points - 1 - i;
  if (range === "1Y") return `${Math.round((daysBack / points) * 12)}mo`;
  return `${daysBack}d`;
}

// ------------------------------------------------------------------
//  Seed airdrop campaigns (admin-managed at runtime)
// ------------------------------------------------------------------

// No demo seeds: campaigns live in per-browser localStorage, so anything
// seeded here resurrects in every fresh browser even after the admin
// deletes it. Real campaigns are created in /admin and read on-chain.
export function seedCampaigns(): AirdropCampaign[] {
  return [];
}

// Admin auth moved server-side — see lib/admin-auth.ts + /api/admin/* routes.
// Set ADMIN_PASSWORD and ADMIN_SESSION_SECRET in .env.local.
