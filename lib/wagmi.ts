import {
  cookieStorage,
  createConfig,
  createStorage,
  http,
} from "wagmi";
import { injected } from "wagmi/connectors";
import { CHAIN_ID, RPC_URL, XPHERE_VIEM } from "./chain";

// MetaMask-only wagmi config. There is no wallet-selection modal: the app
// connects straight to the injected MetaMask provider (lib/use-metamask.ts).
// multiInjectedProviderDiscovery stays off so other injected wallets
// (Rabby, Coinbase, …) never register as connectors.
export const wagmiConfig = createConfig({
  chains: [XPHERE_VIEM],
  connectors: [injected({ target: "metaMask" })],
  transports: { [CHAIN_ID]: http(RPC_URL) },
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  multiInjectedProviderDiscovery: false,
});
