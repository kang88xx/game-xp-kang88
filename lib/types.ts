// Domain types for the IOI DEX (Xphere)

export interface Token {
  symbol: string;
  name: string;
  /** Xphere contract address; null for the native coin (XP) or undeployed tokens */
  address: string | null;
  decimals: number;
  /** CoinGecko id for live market data; null = unlisted (mock market data) */
  coingeckoId: string | null;
  priceUsd: number; // seed value — overridden by live data when available
  change24h: number; // % change, can be negative
  volume24h: number; // USD
  marketCap: number; // USD
  color: string; // logo background color (fallback when no logoUrl)
  logoUrl?: string; // optional logo image (e.g. /tokens/XP.svg)
  logoTransparent?: boolean; // render logo with no background circle
  logoScale?: number; // shrink the logo inside the circle (1 = full, 0.8 = 80%)
}

/** Live market snapshot for one token (from CoinGecko via /api/prices) */
export interface MarketData {
  priceUsd: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  spark7d: number[]; // 7-day sparkline prices (may be empty)
}

export interface Pool {
  id: string;
  token0: string; // token symbol
  token1: string; // token symbol
  feeTier: number; // percent, e.g. 0.3
  tvlUsd: number;
  volume24h: number;
  apr: number; // percent
}

/** Admin-added custom swap token (persisted client-side, merged into the registry) */
export interface AdminToken {
  symbol: string;
  name: string;
  address: string; // Xphere contract — required so it is swappable
  decimals: number;
  color: string; // logo background color
}

export type Eligibility = "public" | "whitelist";

/** One whitelisted wallet: its allocation and whether it has been received. */
export interface WhitelistEntry {
  address: string; // lower-cased EVM address
  amount: number; // tokens allocated to this specific wallet
  claimed: boolean; // marked received (admin) / claimed on-chain
  claimedAt?: number; // epoch ms when marked received
}

export interface AirdropCampaign {
  id: string;
  name: string;
  description: string;
  tokenSymbol: string;
  amountPerClaim: number; // default reward; whitelist wallets use their own amount
  totalAllocation: number;
  claimedCount: number;
  eligibility: Eligibility;
  whitelist: WhitelistEntry[]; // per-wallet allocations (eligibility === "whitelist")
  /** Campaign id in the on-chain MerkleAirdrop contract once launched (claims go live). */
  onchainId?: number;
  active: boolean;
  endsAt: number; // epoch ms
  createdAt: number; // epoch ms
}

export type TxType =
  | "swap"
  // add/remove-liquidity are no longer produced (LP lives on PumpkinSwap)
  // but stay in the union so persisted history keeps rendering.
  | "add-liquidity"
  | "remove-liquidity"
  | "claim"
  | "bet";

export interface Transaction {
  id: string;
  type: TxType;
  summary: string;
  timestamp: number;
  address: string;
}

export interface LpPosition {
  poolId: string;
  amountUsd: number; // value supplied
  sharePct: number; // pool share %
}

// ─── Last Man Standing ───────────────────────────────────────────────────────

export interface LmsBet {
  id: string;
  address: string; // bettor address (real or phantom)
  amount: number; // USDT placed
  timestamp: number; // epoch ms
  roundId: string;
}

export interface LmsPendingClaim {
  id: string;
  roundId: string;
  address: string;
  amount: number;
  createdAt: number; // epoch ms
}

export interface LmsRound {
  id: string;
  status: "active" | "ended";
  endsAt: number; // epoch ms
  prizePool: number; // 80% of all bets accumulate here
  treasuryPool: number; // 15% of all bets
  burnedPool: number; // 5% of all bets
  lastBettor: string | null; // address of most recent bettor
  bets: LmsBet[];
  botBetCount: number; // guard rail: max 5 bot bets per round
}

export interface LmsHistoryEntry {
  roundId: string;
  winner: string | null;
  prize: number;
  endedAt: number;
  isBot?: boolean;
}
