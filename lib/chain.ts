// ------------------------------------------------------------------
//  Single source of truth for the chain the app runs on.
//
//  The DEX runs on XPHERE MAINNET (chainId 20250217) — a custom EVM
//  chain with no viem/AppKit preset. The wallet network object lives in
//  lib/reown.ts (AppKit defineChain); server code builds viem clients
//  from XPHERE_VIEM below. Native coin is XP; WXP is our own WETH9
//  wrapper deployed by dex-contracts alongside the Uniswap-V2-fork
//  factory/router the swap + pools UIs talk to.
// ------------------------------------------------------------------
import type { Chain } from "viem";

export const CHAIN_ID = 20250217;
export const CHAIN_LABEL = "Xphere Mainnet";

/** Native coin symbol — what BNB was on the BSC build. */
export const NATIVE_SYMBOL = "XP";

export const RPC_URL =
  process.env.NEXT_PUBLIC_XPHERE_RPC ?? "https://en-bkk.x-phere.com";
export const EXPLORER_URL =
  process.env.NEXT_PUBLIC_XPHERE_EXPLORER ?? "https://xp.tamsa.io";

/** Plain viem chain object — for server-side public/wallet clients. */
export const XPHERE_VIEM: Chain = {
  id: CHAIN_ID,
  name: CHAIN_LABEL,
  nativeCurrency: { name: "Xphere", symbol: NATIVE_SYMBOL, decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Xplorium/TAMSA", url: EXPLORER_URL } },
};

// Our Uniswap-V2-fork DEX (deployed by dex-contracts — `npm run deploy`
// there prints all three). Swaps/pools stay disabled while these are
// empty. Export names keep the Pancake-era spelling so the rest of the
// app doesn't churn: ROUTER/FACTORY semantics are identical (Router02 ABI,
// getPair/getReserves), only the fee differs (0.30% here vs 0.25%).
export const PANCAKE_ROUTER = (process.env.NEXT_PUBLIC_DEX_ROUTER ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

export const PANCAKE_FACTORY = (process.env.NEXT_PUBLIC_DEX_FACTORY ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

/** Wrapped native XP (WETH9) — the hop token in router paths. */
export const WNATIVE = (process.env.NEXT_PUBLIC_WXP ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

// MerkleAirdrop contract on Xphere — deploy with `npm run deploy:airdrop`,
// then set the address here. Empty = on-chain claims disabled (admin shows
// "deploy first").
export const AIRDROP_CONTRACT = (process.env.NEXT_PUBLIC_AIRDROP_CONTRACT ??
  "") as `0x${string}` | "";

// KangLMS (Last Man Standing game) on Xphere — same deal. Empty = the
// /games page runs in local demo mode.
export const LMS_CONTRACT = (process.env.NEXT_PUBLIC_LMS_CONTRACT ?? "") as
  | `0x${string}`
  | "";
