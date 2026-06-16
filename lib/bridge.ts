// XPBridge-powered cross-chain bridge config — Xphere <-> BSC.
//
// Thin frontend over the public XPBridge zk-bridge (the same contracts +
// relayer that pumpkinswap.app/bridge uses). Flow:
//   1. approve the source-chain bridge contract for `amount` of the token
//   2. call initiateBridge(token, amount, destChainId, destAddress) — locks
//      the token on the source chain and emits BridgeRequest
//   3. the XPBridge relayer releases the paired token on the destination chain
//      to `destAddress` (no further app interaction needed)
//
// Pure data + ABI (no hooks) so it's safe to import from client and server.

export const XPHERE_CHAIN_ID = 20250217;
export const BSC_CHAIN_ID = 56;

export interface BridgeChain {
  chainId: number;
  key: "xphere" | "bsc";
  label: string;
  short: string;
  explorer: string;
  /** Source bridge contract on this chain (initiateBridge lives here). */
  bridge: `0x${string}`;
}

export const BRIDGE_CHAINS: Record<number, BridgeChain> = {
  [XPHERE_CHAIN_ID]: {
    chainId: XPHERE_CHAIN_ID,
    key: "xphere",
    label: "Xphere Mainnet",
    short: "Xphere",
    explorer: "https://xp.tamsa.io",
    bridge: (process.env.NEXT_PUBLIC_XPHERE_BRIDGE_CONTRACT ??
      "0xE546C817791306A5c65D637dC0A40B121e409874") as `0x${string}`,
  },
  [BSC_CHAIN_ID]: {
    chainId: BSC_CHAIN_ID,
    key: "bsc",
    label: "BNB Smart Chain",
    short: "BSC",
    explorer: "https://bscscan.com",
    bridge: (process.env.NEXT_PUBLIC_BSC_BRIDGE_CONTRACT ??
      "0xa26c9A07684EAe63e3fF07FDd5Ecc8353bD06a57") as `0x${string}`,
  },
};

export const BRIDGE_CHAIN_IDS = [XPHERE_CHAIN_ID, BSC_CHAIN_ID] as const;

/** Relayer that watches BridgeRequest events and releases on the dest chain. */
export const BRIDGE_RELAYER_API =
  process.env.NEXT_PUBLIC_BRIDGE_RELAYER_API_URL ??
  "https://xpbridge.app/zk-bridge-relayer/api";

/** Live on Xphere — points at the deployed XPBridge contracts above. */
export const BRIDGE_ENABLED = true;

/** A bridgeable asset and its token contract (+decimals/symbol) per chain. */
export interface BridgeToken {
  /** Stable id for selection. */
  key: string;
  /** Logo under /public/tokens; falls back to a symbol badge. */
  logo?: string;
  chains: Record<
    number,
    { address: `0x${string}`; decimals: number; symbol: string }
  >;
}

export const BRIDGE_TOKENS: BridgeToken[] = [
  {
    key: "usd",
    logo: "/tokens/USDX.svg",
    chains: {
      [XPHERE_CHAIN_ID]: {
        address: "0xb48e189b1059e4D5C8fd154021a0516ff71a8514",
        decimals: 6,
        symbol: "USDX",
      },
      [BSC_CHAIN_ID]: {
        address: "0x55d398326f99059fF775485246999027B3197955",
        decimals: 18,
        symbol: "USDT",
      },
    },
  },
];

/** Tokens bridgeable FROM a given source chain (must exist on both sides). */
export function bridgeTokensForChain(chainId: number): BridgeToken[] {
  const other = otherChainId(chainId);
  return BRIDGE_TOKENS.filter((t) => t.chains[chainId] && t.chains[other]);
}

export function otherChainId(chainId: number): number {
  return chainId === XPHERE_CHAIN_ID ? BSC_CHAIN_ID : XPHERE_CHAIN_ID;
}

/**
 * Fee percent from the contract's raw `bridgeFee` value. XPBridge stores the
 * fee in hundredths of a percent (basis points / 100), so 200 -> 2.0%.
 */
export function bridgeFeePercent(raw: bigint | undefined): number {
  return raw === undefined ? 0 : Number(raw) / 100;
}

// Minimal ABI — only what the bridge UI reads/calls.
export const BRIDGE_ABI = [
  {
    type: "function",
    name: "initiateBridge",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "destinationChainId", type: "uint256" },
      { name: "destinationAddress", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "bridgeFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "defaultMinAmount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "defaultMaxAmount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getTokenInfo",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "supported", type: "bool" },
          { name: "decimals", type: "uint8" },
          { name: "minAmount", type: "uint256" },
          { name: "maxAmount", type: "uint256" },
          { name: "dailyLimit", type: "uint256" },
          { name: "dailyUsage", type: "uint256" },
          { name: "lastResetDay", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getRemainingDailyLimit",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
