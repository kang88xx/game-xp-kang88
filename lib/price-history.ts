// Server-only price history for pool-priced tokens (no CoinGecko feed, e.g.
// KANG). /api/prices records ONE snapshot per hour — the first price seen in
// that hour — into a Redis hash, then computes the 24h change against it:
//
//   baseline = snapshot closest to (now − 24h), at-or-before that moment
//            └ none yet (history younger than 24h) → the OLDEST snapshot,
//              i.e. the "listing price" — exactly how exchanges show a
//              newly listed token's change before a full day of history.
//   change24h = (current − baseline) / baseline
//
// Storage: hash `price:h:<SYMBOL>`, field = hour index (unix ms ÷ 1h), value
// = price. HSETNX keeps the hour's first price and doubles as the throttle —
// no locks. Old fields are pruned on each new-hour insert. ~192 fields max
// (8 days), so a full HGETALL stays a few KB. Without Redis (local dev) an
// in-memory map mirrors the same behavior.
import "server-only";
import { redis } from "./redis";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Keep ~8 days of hourly snapshots (24h change now; 7d charts later). */
const KEEP_HOURS = 8 * 24;

const key = (symbol: string) => `price:h:${symbol}`;
const hourIndex = (ts: number) => Math.floor(ts / HOUR_MS);

// In-memory fallback for local dev (no Redis credentials).
const mem: Record<string, Map<number, number>> = {};

/** All snapshots for a symbol as [hourIndex, price][], ascending by hour. */
async function snapshots(symbol: string): Promise<[number, number][]> {
  if (redis) {
    const all =
      (await redis.hgetall<Record<string, number>>(key(symbol))) ?? {};
    return Object.entries(all)
      .map(([h, p]) => [Number(h), Number(p)] as [number, number])
      .filter(([h, p]) => Number.isFinite(h) && Number.isFinite(p) && p > 0)
      .sort((a, b) => a[0] - b[0]);
  }
  return [...(mem[symbol] ?? new Map())].sort((a, b) => a[0] - b[0]);
}

/**
 * Record this hour's first price for `symbol` (no-op if the hour already has
 * one). Prunes fields older than KEEP_HOURS when a new hour is inserted.
 */
export async function recordPriceSnapshot(
  symbol: string,
  price: number,
  now = Date.now(),
): Promise<void> {
  if (!Number.isFinite(price) || price <= 0) return;
  const h = hourIndex(now);
  if (redis) {
    const inserted = await redis.hsetnx(key(symbol), String(h), price);
    if (inserted) {
      // New hour started → prune anything older than the retention window.
      const all =
        (await redis.hgetall<Record<string, number>>(key(symbol))) ?? {};
      const stale = Object.keys(all).filter((f) => Number(f) < h - KEEP_HOURS);
      if (stale.length) await redis.hdel(key(symbol), ...stale);
    }
    return;
  }
  const map = (mem[symbol] ??= new Map());
  if (!map.has(h)) {
    map.set(h, price);
    for (const f of map.keys()) if (f < h - KEEP_HOURS) map.delete(f);
  }
}

/**
 * 24h change (percent) for `symbol` at `current` price. Baseline is the
 * snapshot at-or-before 24h ago, falling back to the oldest snapshot (the
 * listing price) while history is still shorter than a day. 0 when there is
 * no history at all.
 */
export async function change24h(
  symbol: string,
  current: number,
  now = Date.now(),
): Promise<number> {
  if (!Number.isFinite(current) || current <= 0) return 0;
  const snaps = await snapshots(symbol);
  if (snaps.length === 0) return 0;

  const target = hourIndex(now - DAY_MS);
  let baseline = snaps[0][1]; // oldest = listing price fallback
  for (const [h, p] of snaps) {
    if (h <= target) baseline = p;
    else break;
  }
  if (baseline <= 0) return 0;
  return ((current - baseline) / baseline) * 100;
}
