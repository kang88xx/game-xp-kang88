import { cookieStorage, createStorage } from "@wagmi/core";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { defineChain } from "@reown/appkit/networks";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { CHAIN_ID, CHAIN_LABEL, EXPLORER_URL, NATIVE_SYMBOL, RPC_URL } from "./chain";

// Get one at https://dashboard.reown.com → set in .env.local
export const projectId =
  process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";

if (!projectId && typeof window !== "undefined") {
  console.warn(
    "[reown] NEXT_PUBLIC_REOWN_PROJECT_ID is not set — wallet connection " +
      "will not work. Create a project at https://dashboard.reown.com and " +
      "add the ID to .env.local",
  );
}

// Xphere Mainnet — a custom EVM chain that AppKit/viem don't ship presets
// for. AppKit's defineChain wraps a viem chain with the CAIP fields the
// wallet modal needs. Values come from lib/chain.ts (single source).
export const xphere = defineChain({
  id: CHAIN_ID,
  caipNetworkId: `eip155:${CHAIN_ID}`,
  chainNamespace: "eip155",
  name: CHAIN_LABEL,
  nativeCurrency: { name: "Xphere", symbol: NATIVE_SYMBOL, decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: {
    default: { name: "Xplorium/TAMSA", url: EXPLORER_URL },
  },
});

// BNB Smart Chain — the bridge's destination/source counterpart to Xphere.
// Added so the wallet can switch to BSC for BSC->Xphere bridging and so wagmi
// has a transport for BSC reads. The rest of the app still gates on Xphere
// (CHAIN_ID) and prompts a switch when needed.
export const bscChain = defineChain({
  id: 56,
  caipNetworkId: "eip155:56",
  chainNamespace: "eip155",
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: ["https://bsc-dataseed.bnbchain.org"] } },
  blockExplorers: { default: { name: "BscScan", url: "https://bscscan.com" } },
});

/** The primary wallet-facing network. */
export const ACTIVE_CHAIN: AppKitNetwork = xphere;

export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [xphere, bscChain];

export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  projectId,
  networks,
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
