import {
  cookieStorage,
  createConfig,
  createStorage,
  http,
} from "wagmi";
import { injected } from "wagmi/connectors";
import { CHAIN_ID, RPC_URL, XPHERE_VIEM } from "./chain";

// Injected-wallet wagmi config. EIP-6963 discovery is ON so every announcing
// extension (MetaMask, Zigap, …) registers as its own connector with a name
// and icon; the generic `injected()` fallback covers environments that only
// expose window.ethereum without announcing — e.g. wallet in-app browsers
// (Zigap mobile). The picker UI lives in lib/use-wallet.tsx.
export const wagmiConfig = createConfig({
  chains: [XPHERE_VIEM],
  connectors: [injected()],
  transports: { [CHAIN_ID]: http(RPC_URL) },
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  multiInjectedProviderDiscovery: true,
});
