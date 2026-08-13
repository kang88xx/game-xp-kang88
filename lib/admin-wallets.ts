// Server-only wallet allow-list for the admin panel.
//
// Two tiers:
//   super — hardcoded/env wallets (contract deploy owners). Can add/remove
//           regular admin wallets. Everything else is identical.
//   admin — wallets added by a super admin, stored in Redis (in-memory
//           fallback in local dev without Redis).
import "server-only";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { redis } from "./redis";
import type { AdminRole, AdminSession } from "./admin-auth";

// Contract deploy wallets (on-chain owner() of KangLMS / MerkleAirdrop).
// Override or extend with ADMIN_SUPER_WALLETS=0x…,0x… without a code change.
const DEFAULT_SUPER_ADMINS = [
  "0xe3d18c2d483180b6f119adaaaaf4ade327320358", // KangLMS owner
  "0x70b4b19f85041bea823a72d41f841dc4e028b39d", // MerkleAirdrop owner
];

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

export function superAdmins(): string[] {
  const env = (process.env.ADMIN_SUPER_WALLETS ?? "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter((a) => ADDR_RE.test(a));
  return env.length > 0 ? env : DEFAULT_SUPER_ADMINS;
}

// ─── Regular admin list ─────────────────────────────────────────────────────
// Redis set in production; local dev without Redis falls back to a JSON file
// under .data/ (same pattern as lib/analytics-store.ts) so the list survives
// dev-server restarts.

const WALLETS_KEY = "admin:wallets";
const DATA_DIR = join(process.cwd(), ".data");
const WALLETS_FILE = join(DATA_DIR, "admin-wallets.json");

let memWallets: Set<string> | null = null;

function loadMemWallets(): Set<string> {
  if (memWallets) return memWallets;
  try {
    const raw = JSON.parse(readFileSync(WALLETS_FILE, "utf8")) as string[];
    memWallets = new Set(raw.filter((a) => ADDR_RE.test(a)));
  } catch {
    memWallets = new Set();
  }
  return memWallets;
}

function saveMemWallets(set: Set<string>): void {
  memWallets = set;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(WALLETS_FILE, JSON.stringify([...set]), "utf8");
  } catch {
    // read-only FS — keep in memory only
  }
}

export async function listAdminWallets(): Promise<string[]> {
  if (redis) return (await redis.smembers(WALLETS_KEY)) ?? [];
  return [...loadMemWallets()];
}

export async function addAdminWallet(address: string): Promise<boolean> {
  const addr = address.trim().toLowerCase();
  if (!ADDR_RE.test(addr)) return false;
  if (superAdmins().includes(addr)) return false; // already super
  if (redis) {
    await redis.sadd(WALLETS_KEY, addr);
  } else {
    const set = loadMemWallets();
    set.add(addr);
    saveMemWallets(set);
  }
  return true;
}

export async function removeAdminWallet(address: string): Promise<void> {
  const addr = address.trim().toLowerCase();
  if (redis) {
    await redis.srem(WALLETS_KEY, addr);
  } else {
    const set = loadMemWallets();
    set.delete(addr);
    saveMemWallets(set);
  }
}

/** Wallet tier, or null when the wallet has no admin access at all. */
export async function walletRole(
  address: string,
): Promise<Exclude<AdminRole, "password"> | null> {
  const addr = address.trim().toLowerCase();
  if (superAdmins().includes(addr)) return "super";
  if (redis) return (await redis.sismember(WALLETS_KEY, addr)) ? "admin" : null;
  return loadMemWallets().has(addr) ? "admin" : null;
}

/**
 * The session's effective role for authorization checks. In local dev
 * (no wallet needed on localhost) a password-only session acts as super so
 * the panel stays usable before any wallet is configured; production
 * requires a verified wallet.
 */
export function effectiveRole(session: AdminSession): AdminRole {
  if (
    session.role === "password" &&
    process.env.NODE_ENV === "development"
  ) {
    return "super";
  }
  return session.role;
}

// ─── One-time nonces for wallet-signature verification ──────────────────────

const NONCE_TTL_S = 300;
const nonceKey = (n: string) => `admin:nonce:${n}`;
const memNonces = new Map<string, number>(); // nonce → expiresAt ms

export async function createWalletNonce(): Promise<string> {
  const nonce = randomBytes(16).toString("hex");
  if (redis) {
    await redis.set(nonceKey(nonce), 1, { ex: NONCE_TTL_S });
  } else {
    memNonces.set(nonce, Date.now() + NONCE_TTL_S * 1000);
    // opportunistic sweep so the map can't grow unbounded
    for (const [n, exp] of memNonces) if (exp < Date.now()) memNonces.delete(n);
  }
  return nonce;
}

/** Consume a nonce; true only the first time within its TTL. */
export async function consumeWalletNonce(nonce: string): Promise<boolean> {
  if (!/^[a-f0-9]{32}$/.test(nonce)) return false;
  if (redis) {
    const n = await redis.del(nonceKey(nonce));
    return n === 1;
  }
  const exp = memNonces.get(nonce);
  memNonces.delete(nonce);
  return exp !== undefined && exp >= Date.now();
}

/** The exact message the admin wallet signs (nonce binds it to one attempt). */
export function walletVerifyMessage(nonce: string): string {
  return `XP/GAME admin verification\nnonce: ${nonce}`;
}
