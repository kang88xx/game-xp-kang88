"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useSyncExternalStore } from "react";
import type {
  AdminToken,
  AirdropCampaign,
  LpPosition,
  LmsBet,
  LmsRound,
  LmsHistoryEntry,
  LmsPendingClaim,
  Pool,
  Transaction,
} from "./types";
import { seedCampaigns, seedPools } from "./mock-data";

// NOTE: token balances are no longer stored here — they are read live from
// BSC via wagmi (see lib/balances.ts). Trade execution (swap/LP/claims/bets)
// is disabled in the UI until the on-chain contracts ship.

// ─── Last Man Standing config (exported so UI can import) ────────────────────
export const LMS_CONFIG = {
  MIN_BET: 1,
  BET_ADDS_MS: 30_000,
  MAX_REMAINING_MS: 120_000,
  FEE_PRIZE: 0.8,
  FEE_TREASURY: 0.15,
  FEE_BURN: 0.05,
  BOT_TICK_MS: 10_000,
  BOT_PROBABILITY: 0.6,
  MAX_BOT_BETS: 5,
  HISTORY_CAP: 20,
};

/** Quantize to 6 decimal places — matches USDT on-chain precision */
function quant6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

const PHANTOM_BOTS: string[] = [
  "0xdeadbeef00000000000000000000000000000001",
  "0xdeadbeef00000000000000000000000000000002",
  "0xdeadbeef00000000000000000000000000000003",
  "0xdeadbeef00000000000000000000000000000004",
  "0xdeadbeef00000000000000000000000000000005",
  "0xdeadbeef00000000000000000000000000000006",
];

function uid(prefix = ""): string {
  return prefix + Math.random().toString(36).slice(2, 10);
}

function makeFreshRound(now: number): LmsRound {
  return {
    id: uid("round_"),
    status: "active",
    endsAt: now + 60_000,
    prizePool: 0,
    treasuryPool: 0,
    burnedPool: 0,
    lastBettor: null,
    bets: [],
    botBetCount: 0,
  };
}

function applyBetToRound(
  round: LmsRound,
  bettor: string,
  amount: number,
): LmsRound {
  const prize = quant6(amount * LMS_CONFIG.FEE_PRIZE);
  const treasury = quant6(amount * LMS_CONFIG.FEE_TREASURY);
  const burn = quant6(amount - prize - treasury);

  const now = Date.now();
  const newBet: LmsBet = {
    id: uid("bet_"),
    address: bettor,
    amount,
    timestamp: now,
    roundId: round.id,
  };

  const currentRemaining = round.endsAt - now;
  const newRemaining = Math.min(
    currentRemaining + LMS_CONFIG.BET_ADDS_MS,
    LMS_CONFIG.MAX_REMAINING_MS,
  );
  const newEndsAt = now + newRemaining;

  return {
    ...round,
    prizePool: quant6(round.prizePool + prize),
    treasuryPool: quant6(round.treasuryPool + treasury),
    burnedPool: quant6(round.burnedPool + burn),
    lastBettor: bettor,
    endsAt: newEndsAt,
    bets: [newBet, ...round.bets],
  };
}

// ─── Pure round-finalization helper ──────────────────────────────────────────
function finalizeRoundIfExpired(
  round: LmsRound,
  history: LmsHistoryEntry[],
  pendingClaims: LmsPendingClaim[],
  now: number,
): { round: LmsRound; history: LmsHistoryEntry[]; pendingClaims: LmsPendingClaim[] } | null {
  if (round.endsAt > now) return null;

  // Empty round — no winner, just start fresh
  if (!round.lastBettor) {
    return { round: makeFreshRound(now), history, pendingClaims };
  }

  const isBot = PHANTOM_BOTS.includes(round.lastBettor);
  const historyEntry: LmsHistoryEntry = {
    roundId: round.id,
    winner: round.lastBettor,
    prize: round.prizePool,
    endedAt: round.endsAt,
    isBot,
  };

  let newPendingClaims = pendingClaims;
  if (!isBot) {
    const claim: LmsPendingClaim = {
      id: uid("claim_"),
      roundId: round.id,
      address: round.lastBettor,
      amount: round.prizePool,
      createdAt: now,
    };
    newPendingClaims = [claim, ...pendingClaims];
  }

  const newHistory = [historyEntry, ...history].slice(0, LMS_CONFIG.HISTORY_CAP);

  return { round: makeFreshRound(now), history: newHistory, pendingClaims: newPendingClaims };
}

interface DexState {
  // wallet
  connected: boolean;
  address: string | null;

  // per-address data (LP positions / airdrop claims — populated again once
  // on-chain execution ships)
  positions: Record<string, LpPosition[]>;
  claims: Record<string, string[]>;

  transactions: Transaction[];
  campaigns: AirdropCampaign[];

  // admin-managed swap token registry (merged with the static registry)
  adminTokens: AdminToken[];
  disabledTokens: string[]; // symbols hidden from swapping
  removedTokens: string[]; // static-registry symbols delisted entirely (restorable)

  // admin-managed liquidity pools (only pools that actually exist)
  pools: Pool[];
  hiddenPools: string[]; // pool ids hidden from the public /pools list

  // Last Man Standing
  lms: {
    round: LmsRound;
    history: LmsHistoryEntry[];
    pendingClaims: LmsPendingClaim[];
  };

  // wallet actions
  /** Mirror the real wagmi/AppKit session into the store (null = disconnected). */
  setWalletSession: (address: string | null) => void;

  /** Record a confirmed on-chain transaction for the activity feed. */
  recordTransaction: (type: Transaction["type"], summary: string) => void;

  // games — Last Man Standing (bot demo rounds only; user bets/claims are
  // disabled until the on-chain game contract ships)
  lmsEnsureRound: () => void;
  lmsCheckExpiry: () => void;
  lmsBotTick: () => void;

  // admin
  createCampaign: (
    c: Omit<AirdropCampaign, "id" | "claimedCount" | "createdAt">,
  ) => void;
  updateCampaign: (id: string, patch: Partial<AirdropCampaign>) => void;
  deleteCampaign: (id: string) => void;
  addToWhitelist: (
    campaignId: string,
    address: string,
    amount: number,
  ) => void;
  addManyToWhitelist: (
    campaignId: string,
    entries: { address: string; amount: number }[],
  ) => void;
  removeFromWhitelist: (campaignId: string, address: string) => void;
  setWhitelistClaimed: (
    campaignId: string,
    address: string,
    claimed: boolean,
  ) => void;
  recordClaim: (campaignId: string) => void;

  // admin — swap token registry
  addAdminToken: (token: AdminToken) => void;
  removeAdminToken: (symbol: string) => void;
  setTokenEnabled: (symbol: string, enabled: boolean) => void;
  /** Delist a static-registry token entirely (reversible via restoreToken). */
  removeToken: (symbol: string) => void;
  restoreToken: (symbol: string) => void;

  // admin — liquidity pools
  addPool: (pool: Omit<Pool, "id">) => void;
  removePool: (id: string) => void;
  /** Hide/show a pool on the public /pools list (positions stay withdrawable). */
  setPoolVisible: (id: string, visible: boolean) => void;
}

export const useDexStore = create<DexState>()(
  persist(
    (set, get) => ({
      connected: false,
      address: null,
      positions: {},
      claims: {},
      transactions: [],
      campaigns: seedCampaigns(),
      adminTokens: [],
      disabledTokens: [],
      removedTokens: [],
      pools: seedPools(),
      hiddenPools: [],
      lms: {
        round: makeFreshRound(Date.now()),
        history: [],
        pendingClaims: [],
      },

      setWalletSession: (address) => {
        if (!address) {
          set({ connected: false, address: null });
          return;
        }
        set({ connected: true, address });
      },

      recordTransaction: (type, summary) =>
        set((s) => ({
          transactions: [
            {
              id: uid("tx_"),
              type,
              summary,
              timestamp: Date.now(),
              address: s.address ?? "",
            },
            ...s.transactions,
          ].slice(0, 60),
        })),

      // ─── Last Man Standing actions ───────────────────────────────────────

      lmsEnsureRound: () => {
        const { lms } = get();
        const now = Date.now();
        if (!lms.round) {
          set((s) => ({ lms: { ...s.lms, round: makeFreshRound(now) } }));
          return;
        }
        const result = finalizeRoundIfExpired(
          lms.round,
          lms.history,
          lms.pendingClaims,
          now,
        );
        if (result) {
          set((s) => ({ lms: { ...s.lms, ...result } }));
        }
      },

      lmsCheckExpiry: () => {
        const { lms } = get();
        const now = Date.now();
        const result = finalizeRoundIfExpired(
          lms.round,
          lms.history,
          lms.pendingClaims,
          now,
        );
        if (result) {
          set((s) => ({ lms: { ...s.lms, ...result } }));
        }
      },

      lmsBotTick: () => {
        const { lms } = get();
        const now = Date.now();

        // Finalize expired round before bot logic
        const finalized = finalizeRoundIfExpired(
          lms.round,
          lms.history,
          lms.pendingClaims,
          now,
        );
        if (finalized) {
          set((s) => ({ lms: { ...s.lms, ...finalized } }));
          return;
        }

        if (lms.round.status !== "active") return;
        const remaining = lms.round.endsAt - now;
        if (remaining <= 5_000) return;
        if (lms.round.botBetCount >= LMS_CONFIG.MAX_BOT_BETS) return;

        // Check last bet time (skip if a bet was placed within the last 5s)
        const lastBet = lms.round.bets[0];
        if (lastBet && now - lastBet.timestamp < 5_000) return;

        if (Math.random() >= LMS_CONFIG.BOT_PROBABILITY) return;

        const botAddr =
          PHANTOM_BOTS[Math.floor(Math.random() * PHANTOM_BOTS.length)];
        const betAmount = quant6(Math.floor(Math.random() * 5) + 1); // 1-5 USDT

        const updatedRound = applyBetToRound(lms.round, botAddr, betAmount);

        set((s) => ({
          lms: {
            ...s.lms,
            round: {
              ...updatedRound,
              botBetCount: s.lms.round.botBetCount + 1,
            },
          },
        }));
      },

      createCampaign: (c) =>
        set((s) => ({
          campaigns: [
            {
              ...c,
              id: uid("camp_"),
              claimedCount: 0,
              createdAt: Date.now(),
              whitelist: c.whitelist.map((w) => ({
                ...w,
                address: w.address.toLowerCase(),
              })),
            },
            ...s.campaigns,
          ],
        })),

      updateCampaign: (id, patch) =>
        set((s) => ({
          campaigns: s.campaigns.map((c) =>
            c.id === id ? { ...c, ...patch } : c,
          ),
        })),

      deleteCampaign: (id) =>
        set((s) => ({ campaigns: s.campaigns.filter((c) => c.id !== id) })),

      // Adding an address that already exists ACCUMULATES its allocation.
      addToWhitelist: (campaignId, address, amount) =>
        set((s) => ({
          campaigns: s.campaigns.map((c) => {
            if (c.id !== campaignId) return c;
            const addr = address.trim().toLowerCase();
            if (!addr || !Number.isFinite(amount) || amount <= 0) return c;
            const idx = c.whitelist.findIndex((w) => w.address === addr);
            if (idx >= 0) {
              const whitelist = [...c.whitelist];
              whitelist[idx] = {
                ...whitelist[idx],
                amount: whitelist[idx].amount + amount,
              };
              return { ...c, whitelist };
            }
            return {
              ...c,
              whitelist: [
                ...c.whitelist,
                { address: addr, amount, claimed: false },
              ],
            };
          }),
        })),

      // Batch apply many allocations in one update; duplicates (incl. repeats
      // within `entries`) accumulate onto the existing/first amount.
      addManyToWhitelist: (campaignId, entries) =>
        set((s) => ({
          campaigns: s.campaigns.map((c) => {
            if (c.id !== campaignId) return c;
            const map = new Map(c.whitelist.map((w) => [w.address, { ...w }]));
            for (const e of entries) {
              const addr = e.address.trim().toLowerCase();
              if (!addr || !Number.isFinite(e.amount) || e.amount <= 0) continue;
              const existing = map.get(addr);
              if (existing) existing.amount += e.amount;
              else map.set(addr, { address: addr, amount: e.amount, claimed: false });
            }
            return { ...c, whitelist: [...map.values()] };
          }),
        })),

      removeFromWhitelist: (campaignId, address) =>
        set((s) => ({
          campaigns: s.campaigns.map((c) =>
            c.id === campaignId
              ? {
                  ...c,
                  whitelist: c.whitelist.filter(
                    (w) => w.address !== address.toLowerCase(),
                  ),
                }
              : c,
          ),
        })),

      setWhitelistClaimed: (campaignId, address, claimed) =>
        set((s) => ({
          campaigns: s.campaigns.map((c) =>
            c.id === campaignId
              ? {
                  ...c,
                  whitelist: c.whitelist.map((w) =>
                    w.address === address.toLowerCase()
                      ? {
                          ...w,
                          claimed,
                          claimedAt: claimed ? Date.now() : undefined,
                        }
                      : w,
                  ),
                }
              : c,
          ),
        })),

      // Record that the connected wallet claimed a campaign (after the on-chain
      // claim tx confirms). Also marks the whitelist entry received.
      recordClaim: (campaignId) =>
        set((s) => {
          const addr = s.address;
          if (!addr) return s;
          const prev = s.claims[addr] ?? [];
          const claims = prev.includes(campaignId)
            ? s.claims
            : { ...s.claims, [addr]: [...prev, campaignId] };
          return {
            claims,
            campaigns: s.campaigns.map((c) =>
              c.id === campaignId
                ? {
                    ...c,
                    claimedCount: c.claimedCount + 1,
                    whitelist: c.whitelist.map((w) =>
                      w.address === addr.toLowerCase()
                        ? { ...w, claimed: true, claimedAt: Date.now() }
                        : w,
                    ),
                  }
                : c,
            ),
          };
        }),

      addAdminToken: (token) =>
        set((s) => {
          const symbol = token.symbol.trim().toUpperCase();
          if (!symbol || s.adminTokens.some((t) => t.symbol === symbol)) {
            return s;
          }
          return {
            adminTokens: [
              ...s.adminTokens,
              { ...token, symbol, address: token.address.trim() },
            ],
            // a freshly added token is enabled by default
            disabledTokens: s.disabledTokens.filter((sym) => sym !== symbol),
          };
        }),

      removeAdminToken: (symbol) =>
        set((s) => ({
          adminTokens: s.adminTokens.filter((t) => t.symbol !== symbol),
          disabledTokens: s.disabledTokens.filter((sym) => sym !== symbol),
        })),

      setTokenEnabled: (symbol, enabled) =>
        set((s) => ({
          disabledTokens: enabled
            ? s.disabledTokens.filter((sym) => sym !== symbol)
            : s.disabledTokens.includes(symbol)
              ? s.disabledTokens
              : [...s.disabledTokens, symbol],
        })),

      removeToken: (symbol) =>
        set((s) => ({
          removedTokens: (s.removedTokens ?? []).includes(symbol)
            ? s.removedTokens
            : [...(s.removedTokens ?? []), symbol],
          disabledTokens: s.disabledTokens.filter((sym) => sym !== symbol),
        })),

      restoreToken: (symbol) =>
        set((s) => ({
          removedTokens: (s.removedTokens ?? []).filter(
            (sym) => sym !== symbol,
          ),
        })),

      addPool: (pool) =>
        set((s) => {
          const base = `${pool.token0}-${pool.token1}`.toLowerCase();
          let id = base;
          let n = 2;
          while (s.pools.some((p) => p.id === id)) id = `${base}-${n++}`;
          return { pools: [...s.pools, { ...pool, id }] };
        }),

      removePool: (id) =>
        set((s) => ({
          pools: s.pools.filter((p) => p.id !== id),
          hiddenPools: (s.hiddenPools ?? []).filter((pid) => pid !== id),
        })),

      setPoolVisible: (id, visible) =>
        set((s) => ({
          hiddenPools: visible
            ? (s.hiddenPools ?? []).filter((pid) => pid !== id)
            : (s.hiddenPools ?? []).includes(id)
              ? s.hiddenPools
              : [...(s.hiddenPools ?? []), id],
        })),
    }),
    {
      // bumped from helix-dex-store → reseeds with IOI tokens/campaigns
      // v3: replaced Coin Flip with Last Man Standing
      // v4: unified round finalization, pendingClaims, LMS_CONFIG export
      // v5: real wallet via Reown AppKit — connected/address now mirror wagmi
      //     and are no longer persisted here (wagmi cookie storage owns them)
      // v6: real BSC balances via wagmi — demo balance ledger and mock trade
      //     actions (swap/LP/claims/bets) removed
      // v7: reseed campaigns for the BSC token/pool registry
      // v8: admin-managed swap token registry (adminTokens / disabledTokens)
      // v9: admin-managed liquidity pools (real pools only)
      name: "ioi-dex-store",
      // v10: whitelist entries gained per-wallet amount + claimed
      // v11: airdrop contract redeployed (v4) — old onchainIds point at the
      //      abandoned v2 contract, so launched campaigns revert to drafts
      // v12: demo seed campaigns (genesis / early-supporter) removed — they
      //      respawned in every fresh browser after the admin deleted them
      // v13: chain moved BSC → Xphere Mainnet — every persisted pool/token/
      //      campaign/tx references retired BSC contracts, so wipe to seeds
      version: 13,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) =>
        Object.fromEntries(
          Object.entries(s).filter(
            ([k]) => !["connected", "address"].includes(k),
          ),
        ) as DexState,
      migrate: (persisted, version) => {
        const p = persisted as Record<string, unknown>;
        delete p.connected;
        delete p.address;
        delete p.balances;
        // v12 → v13: BSC → Xphere. Pools, admin tokens, campaigns and tx
        // history all point at BSC-era contracts — reset to fresh seeds.
        if (version < 13) {
          delete p.pools;
          delete p.adminTokens;
          delete p.removedTokens;
          delete p.campaigns;
          delete p.claims;
          delete p.transactions;
          delete p.lms;
          return p as unknown as DexState;
        }
        if (version < 10) {
          // reseed campaigns — old ones reference pre-BSC tokens/pools
          delete p.campaigns;
          return p as unknown as DexState;
        }
        // v10 → v11: keep campaign names/whitelists but strip launch state
        // (onchainId, claim marks) so they can launch fresh on the new
        // contract. Stale per-wallet claim records go too.
        if (version < 11) {
          if (Array.isArray(p.campaigns)) {
            p.campaigns = (p.campaigns as AirdropCampaign[]).map((c) => ({
              ...c,
              onchainId: undefined,
              claimedCount: 0,
              whitelist: (c.whitelist ?? []).map((w) => ({
                ...w,
                claimed: false,
              })),
            }));
          }
          p.claims = {};
        }
        // v11 → v12: drop the demo seed campaigns. They were baked into every
        // fresh browser's localStorage, so deleting them in /admin couldn't
        // make them disappear for visitors. Launched ones are kept on-chain.
        if (Array.isArray(p.campaigns)) {
          p.campaigns = (p.campaigns as AirdropCampaign[]).filter(
            (c) =>
              !(
                (c.id === "genesis" || c.id === "early-supporter") &&
                c.onchainId == null
              ),
          );
        }
        return p as unknown as DexState;
      },
    },
  ),
);

// ------------------------------------------------------------------
//  Hydration guard — avoids SSR/CSR mismatch for persisted state
// ------------------------------------------------------------------

// useSyncExternalStore gives a server snapshot (false) and a client snapshot
// (true) without a set-state-in-effect, so persisted/client-only UI can gate
// safely and stay lint-clean under React 19 hooks rules.
const noopSubscribe = () => () => {};
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

// Convenience selectors -------------------------------------------------
// NB: return *stable* empty references so zustand v5's Object.is snapshot
// comparison does not trigger an infinite render loop.

const EMPTY_POSITIONS: LpPosition[] = [];
const EMPTY_IDS: string[] = [];

// Token balances moved on-chain — see useBalances/useBalance in lib/balances.ts

export function usePositions(): LpPosition[] {
  return useDexStore((s) =>
    s.address ? s.positions[s.address] ?? EMPTY_POSITIONS : EMPTY_POSITIONS,
  );
}

export function useClaimedIds(): string[] {
  return useDexStore((s) =>
    s.address ? s.claims[s.address] ?? EMPTY_IDS : EMPTY_IDS,
  );
}
