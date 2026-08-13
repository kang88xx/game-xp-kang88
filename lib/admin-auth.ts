// Server-only admin session helpers — never import from client code.
import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { redis } from "./redis";

export const ADMIN_COOKIE = "ioi_admin_session";
export const SESSION_TTL_S = 60 * 60 * 24; // 24h

function secret(): string {
  return process.env.ADMIN_SESSION_SECRET ?? "";
}

/** True when both ADMIN_PASSWORD and ADMIN_SESSION_SECRET are set. */
export function adminConfigured(): boolean {
  return !!process.env.ADMIN_PASSWORD && !!secret();
}

/**
 * Session-signing key derived from BOTH the session secret and the admin
 * password. Rotating either env var (then redeploying) invalidates every
 * outstanding session at once — the revocation story for stateless tokens.
 */
function signingKey(): Buffer {
  return createHmac("sha256", secret())
    .update(`session-key|${process.env.ADMIN_PASSWORD ?? ""}`)
    .digest();
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("hex");
}

/** Constant-time string comparison via SHA-256 digests (equal length). */
function safeEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}

/**
 * Client IP for rate limiting. x-real-ip is set by the platform (Vercel) and
 * can't be spoofed; fallback is the LAST x-forwarded-for entry — proxies
 * append the real peer IP, so the first entry is client-controlled but the
 * last isn't.
 */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = req.headers.get("x-forwarded-for")?.split(",") ?? [];
  return fwd.at(-1)?.trim() || "local";
}

/**
 * CSRF defense for state-changing POSTs: when the browser sends an Origin
 * header it must match the request Host. Requests with no Origin (server-to-
 * server, curl) are allowed — they carry no ambient cookie and the password
 * still gates the sensitive routes; the goal is blocking cross-site browser
 * form/fetch CSRF, which always sets Origin.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

export function verifyPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !password) return false;
  return safeEqual(password, expected);
}

// ─── Session token ──────────────────────────────────────────────────────────
// Stateless HMAC token: "v2.<base64url(JSON payload)>.<signature>".
// The payload carries the wallet identity once the admin proves ownership of
// an allow-listed wallet (see /api/admin/wallet-verify):
//   role "password" — password unlocked, wallet not verified yet
//   role "admin"    — wallet in the regular-admin list
//   role "super"    — wallet in the super-admin list (can manage admins)

export type AdminRole = "password" | "admin" | "super";

export interface AdminSession {
  exp: number; // epoch ms
  role: AdminRole;
  address?: string; // lower-cased wallet, present once wallet-verified
}

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64url = (s: string) => Buffer.from(s, "base64url").toString("utf8");

export function createSessionToken(
  wallet?: { address: string; role: Exclude<AdminRole, "password"> },
): string {
  const payload: AdminSession = {
    exp: Date.now() + SESSION_TTL_S * 1000,
    role: wallet?.role ?? "password",
    ...(wallet ? { address: wallet.address.toLowerCase() } : {}),
  };
  const body = b64url(JSON.stringify(payload));
  return `v2.${body}.${sign(body)}`;
}

/** Parsed session payload when the token is valid and unexpired, else null. */
export function verifySessionToken(
  token: string | undefined,
): AdminSession | null {
  if (!token || !secret()) return null;
  const [ver, body, sig] = token.split(".");
  if (ver !== "v2" || !body || !sig) return null;
  if (!safeEqual(sign(body), sig)) return null;
  try {
    const payload = JSON.parse(unb64url(body)) as AdminSession;
    if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
    if (!["password", "admin", "super"].includes(payload.role)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─── Login rate limit ───────────────────────────────────────────────────────
// Shared Upstash Redis (atomic INCR + EXPIRE) when configured, so the limit
// holds across all serverless instances/cold starts — the per-instance Map
// fallback below only applies in local dev without Redis.

const WINDOW_MS = 10 * 60 * 1000;
const WINDOW_S = Math.floor(WINDOW_MS / 1000);
const MAX_ATTEMPTS = 5;
const attempts = new Map<string, { count: number; resetAt: number }>();
const rlKey = (ip: string) => `rl:login:${ip}`;

/** Returns true if the attempt is allowed; false once the IP is over budget. */
export async function rateLimitLogin(ip: string): Promise<boolean> {
  if (redis) {
    const key = rlKey(ip);
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, WINDOW_S);
    return n <= MAX_ATTEMPTS;
  }
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_ATTEMPTS) return false;
  entry.count += 1;
  return true;
}

export async function clearRateLimit(ip: string): Promise<void> {
  if (redis) {
    await redis.del(rlKey(ip));
    return;
  }
  attempts.delete(ip);
}
