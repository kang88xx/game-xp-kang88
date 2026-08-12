"use client";

import { useState } from "react";
import { Loader2, Network } from "lucide-react";
import { useAccount } from "wagmi";
import {
  CHAIN_ID,
  CHAIN_LABEL,
  NATIVE_SYMBOL,
  RPC_URL,
  EXPLORER_URL,
} from "@/lib/chain";
import { toast } from "./toast";

/** EIP-1193 provider surface we need (connector provider or window.ethereum). */
type Eip1193 = { request(args: { method: string; params?: unknown }): Promise<unknown> };

const METAMASK_INSTALL_URL = "https://metamask.io/download";

/**
 * "Add Xphere Mainnet" — prompts the wallet to register the chain via
 * `wallet_addEthereumChain`. Works even before the site is connected:
 * falls back to the injected provider (window.ethereum) so a visitor can
 * set up their MetaMask with one click. If the chain already exists the
 * wallet simply offers to switch to it.
 */
export function AddNetworkButton({
  variant = "pill",
  className = "",
}: {
  /** "pill" = standalone bordered button · "menu" = dropdown row */
  variant?: "pill" | "menu";
  className?: string;
}) {
  const { isConnected, connector } = useAccount();
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    try {
      const provider =
        isConnected && connector
          ? ((await connector.getProvider()) as Eip1193)
          : ((window as { ethereum?: Eip1193 }).ethereum ?? null);

      if (!provider) {
        toast.error("MetaMask is not installed");
        window.open(METAMASK_INSTALL_URL, "_blank", "noopener");
        return;
      }

      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${CHAIN_ID.toString(16)}`,
            chainName: CHAIN_LABEL,
            nativeCurrency: {
              name: "Xphere",
              symbol: NATIVE_SYMBOL,
              decimals: 18,
            },
            rpcUrls: [RPC_URL],
            blockExplorerUrls: [EXPLORER_URL],
          },
        ],
      });

      toast.success(`${CHAIN_LABEL} is set up in your wallet`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      // User rejection is not an error worth shouting about.
      if (/reject|denied|cancel/i.test(msg)) toast.info("Cancelled");
      else toast.error(`Couldn't add ${CHAIN_LABEL}`);
    } finally {
      setBusy(false);
    }
  };

  if (variant === "menu") {
    return (
      <button
        type="button"
        onClick={add}
        disabled={busy}
        className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-[var(--surface)] disabled:opacity-60 ${className}`}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin text-[var(--muted)]" />
        ) : (
          <Network className="h-4 w-4 text-[var(--muted)]" />
        )}
        Add Xphere network
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={add}
      disabled={busy}
      title={`Registers ${CHAIN_LABEL} (chain ${CHAIN_ID}) in MetaMask — RPC, currency and explorer are filled in automatically.`}
      className={`inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3.5 py-2 text-xs font-medium text-[var(--muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--foreground)] disabled:opacity-60 ${className}`}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Network className="h-3.5 w-3.5" />
      )}
      Add {CHAIN_LABEL} to MetaMask
    </button>
  );
}
