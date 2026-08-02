// Server-only analytics counters — never import from client code.
//
// Durable storage via Upstash Redis when configured (UPSTASH_REDIS_REST_URL +
// _TOKEN, or Vercel's KV_REST_API_* aliases) — survives redeploys/cold starts
// and is shared across all serverless instances. Without those env vars (local
// dev, or before provisioning) it falls back to an in-memory store with
// best-effort JSON file persistence, exactly as before. All functions are
// async; the Redis path awaits the network, the in-memory path resolves
// immediately.
import "server-only";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { redis } from "./redis";

const DIR = join(process.cwd(), ".data");
const FILE = join(DIR, "analytics.json");

/** A single new-wallet connection — address + unix ms of first connect. */
export interface ConnectionLog {
  address: string;
  ts: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TX_DEDUPE_MS = 7 * DAY_MS;

// Key namespace. Redis client comes from lib/redis.ts (null → in-memory).
const K = {
  visitorsByDay: "a:visitorsByDay",
  volumeByDay: "a:volumeByDay",
  seenWallets: "a:seenWallets",
  connLog: "a:connLog",
  swapLog: "a:swapLog",
  swapTx: (h: string) => `a:swaptx:${h}`,
};

/** Upstash may return a member as an already-parsed object or a JSON string. */
function asSwap(m: unknown): { pair: string; usd: number; ts: number } | null {
  try {
    const o = typeof m === "string" ? JSON.parse(m) : (m as Record<string, unknown>);
    if (o && typeof o.pair === "string" && typeof o.usd === "number" && typeof o.ts === "number")
      return { pair: o.pair, usd: o.usd, ts: o.ts };
  } catch {
    // malformed member → skip
  }
  return null;
}

// ---------------------------------------------------------------------------
// In-memory backend (dev fallback) + file persistence.
// ---------------------------------------------------------------------------

interface SwapLogEntry {
  pair: string;
  usd: number;
  ts: number;
}

interface Data {
  visitorsByDay: Record<string, number>;
  volumeByDay: Record<string, number>;
  connectionsTotal: number;
  seenWallets: string[];
  connectionLog: ConnectionLog[];
  swapLog: SwapLogEntry[];
  seenSwapTxs: Record<string, number>;
}

function empty(): Data {
  return {
    visitorsByDay: {},
    volumeByDay: {},
    connectionsTotal: 0,
    seenWallets: [],
    connectionLog: [],
    swapLog: [],
    seenSwapTxs: {},
  };
}

let cache: Data | null = null;

function load(): Data {
  if (cache) return cache;
  try {
    cache = { ...empty(), ...(JSON.parse(readFileSync(FILE, "utf8")) as Data) };
  } catch {
    cache = empty();
  }
  return cache;
}

function save(d: Data): void {
  cache = d;
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(d), "utf8");
  } catch {
    // read-only FS — keep counters in memory only
  }
}

// ---------------------------------------------------------------------------
// Public API — same shapes as before, now async.
// ---------------------------------------------------------------------------

/** KST (UTC+9, no DST) calendar date key, e.g. "2026-06-10". */
export function kstDayKey(now = Date.now()): string {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function recordVisit(now = Date.now()): Promise<void> {
  const k = kstDayKey(now);
  if (redis) {
    await redis.hincrby(K.visitorsByDay, k, 1);
    return;
  }
  const d = load();
  d.visitorsByDay[k] = (d.visitorsByDay[k] ?? 0) + 1;
  save(d);
}

/** Counts each wallet once, all-time (new wallets only). */
export async function recordConnection(
  address: string,
  now = Date.now(),
): Promise<void> {
  const addr = address.toLowerCase();
  if (redis) {
    const added = await redis.sadd(K.seenWallets, addr);
    if (added) await redis.rpush(K.connLog, JSON.stringify({ address: addr, ts: now }));
    return;
  }
  const d = load();
  if (d.seenWallets.includes(addr)) return;
  d.seenWallets.push(addr);
  d.connectionsTotal += 1;
  d.connectionLog.push({ address: addr, ts: now });
  save(d);
}

/** Full new-wallet connection log, newest first. */
export async function connectionLog(): Promise<ConnectionLog[]> {
  if (redis) {
    const raw = await redis.lrange<unknown>(K.connLog, 0, -1);
    const out: ConnectionLog[] = [];
    for (const m of raw) {
      try {
        const o = typeof m === "string" ? JSON.parse(m) : (m as ConnectionLog);
        if (o && typeof o.address === "string" && typeof o.ts === "number")
          out.push({ address: o.address, ts: o.ts });
      } catch {
        // skip malformed
      }
    }
    return out.sort((a, b) => b.ts - a.ts);
  }
  return [...load().connectionLog].sort((a, b) => b.ts - a.ts);
}

/** Per-day visitor counts (KST day key + count), newest day first. */
export async function visitorDays(): Promise<{ date: string; count: number }[]> {
  const byDay = redis
    ? ((await redis.hgetall<Record<string, number>>(K.visitorsByDay)) ?? {})
    : load().visitorsByDay;
  return Object.entries(byDay)
    .map(([date, count]) => ({ date, count: Number(count) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Records swap volume once per tx hash. Returns false (and records nothing)
 * when the hash was already counted — the on-chain replay guard.
 */
export async function recordVolume(
  usd: number,
  txHash: string,
  pair?: string,
  now = Date.now(),
): Promise<boolean> {
  if (!Number.isFinite(usd) || usd <= 0) return false;
  const hash = txHash.toLowerCase();
  const k = kstDayKey(now);

  if (redis) {
    // SET NX is the atomic replay guard: only the first report wins.
    const fresh = await redis.set(K.swapTx(hash), 1, {
      nx: true,
      ex: Math.floor(TX_DEDUPE_MS / 1000),
    });
    if (fresh !== "OK") return false;
    await redis.hincrbyfloat(K.volumeByDay, k, usd);
    if (pair) {
      await redis.zadd(K.swapLog, {
        score: now,
        member: JSON.stringify({ pair, usd, ts: now }),
      });
      await redis.zremrangebyscore(K.swapLog, 0, now - DAY_MS);
    }
    return true;
  }

  const d = load();
  const seen = d.seenSwapTxs ?? {};
  for (const [h, ts] of Object.entries(seen)) {
    if (now - ts >= TX_DEDUPE_MS) delete seen[h];
  }
  if (seen[hash] !== undefined) return false;
  seen[hash] = now;
  d.seenSwapTxs = seen;
  d.volumeByDay[k] = (d.volumeByDay[k] ?? 0) + usd;
  if (pair) {
    d.swapLog = (d.swapLog ?? []).filter((e) => now - e.ts < DAY_MS);
    d.swapLog.push({ pair, usd, ts: now });
  }
  save(d);
  return true;
}

/** Rolling 24h swap volume (USD) per token-pair key, e.g. { "BNB-USDT": 1234 }. */
export async function volume24hByPair(
  now = Date.now(),
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (redis) {
    await redis.zremrangebyscore(K.swapLog, 0, now - DAY_MS);
    const members = await redis.zrange<unknown[]>(K.swapLog, now - DAY_MS, now, {
      byScore: true,
    });
    for (const m of members) {
      const e = asSwap(m);
      if (e && now - e.ts < DAY_MS) out[e.pair] = (out[e.pair] ?? 0) + e.usd;
    }
    return out;
  }
  (load().swapLog ?? []).forEach((e) => {
    if (now - e.ts >= DAY_MS) return;
    out[e.pair] = (out[e.pair] ?? 0) + e.usd;
  });
  return out;
}

export interface TodaySummary {
  day: string;
  visitors: number;
  /** Cumulative visitors across all days. */
  visitorsTotal: number;
  /** Cumulative unique-wallet connections, all-time. */
  connections: number;
  volumeUsd: number;
}

export async function todaySummary(now = Date.now()): Promise<TodaySummary> {
  const k = kstDayKey(now);
  if (redis) {
    const [visitorsToday, byDay, connections, volToday] = await Promise.all([
      redis.hget<number>(K.visitorsByDay, k),
      redis.hgetall<Record<string, number>>(K.visitorsByDay),
      redis.scard(K.seenWallets),
      redis.hget<number>(K.volumeByDay, k),
    ]);
    const visitorsTotal = Object.values(byDay ?? {}).reduce(
      (sum, n) => sum + Number(n),
      0,
    );
    return {
      day: k,
      visitors: Number(visitorsToday ?? 0),
      visitorsTotal,
      connections: Number(connections ?? 0),
      volumeUsd: Number(volToday ?? 0),
    };
  }
  const d = load();
  const visitorsTotal = Object.values(d.visitorsByDay).reduce(
    (sum, n) => sum + n,
    0,
  );
  return {
    day: k,
    visitors: d.visitorsByDay[k] ?? 0,
    visitorsTotal,
    connections: d.connectionsTotal,
    volumeUsd: d.volumeByDay[k] ?? 0,
  };
}
