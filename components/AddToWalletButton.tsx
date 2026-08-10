"use client";

import { useState } from "react";
import { Plus, Info } from "lucide-react";
import { useAccount } from "wagmi";
import { getToken } from "@/lib/tokens";
import { CHAIN_LABEL } from "@/lib/chain";
import { toast } from "./toast";

/** EIP-1193 provider surface we need from the active connector. */
type Eip1193 = { request(args: { method: string; params?: unknown }): Promise<unknown> };

/**
 * "Add to MetaMask" — prompts the wallet to watch this ERC-20 via
 * `wallet_watchAsset` so it shows up in the user's token list.
 * Native coins (XP, address === null) can't be watched, so we render nothing.
 */
export function AddToWalletButton({
  symbol,
  className = "",
}: {
  symbol: string;
  className?: string;
}) {
  const token = getToken(symbol);
  const { isConnected, connector } = useAccount();
  const [busy, setBusy] = useState(false);

  // Only ERC-20s with a real contract can be watched.
  if (!token || !token.address) return null;

  const add = async () => {
    if (!isConnected || !connector) {
      toast.info("Connect your wallet first");
      return;
    }
    setBusy(true);
    try {
      const provider = (await connector.getProvider()) as Eip1193;
      // Absolute URL — wallets can't resolve app-relative paths. PNG only;
      // most wallets ignore SVG, so we just omit the image for those.
      const image =
        token.logoUrl && token.logoUrl.endsWith(".png") && typeof window !== "undefined"
          ? `${window.location.origin}${token.logoUrl}`
          : undefined;

      const added = await provider.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: {
            address: token.address,
            symbol: token.symbol,
            decimals: token.decimals,
            ...(image ? { image } : {}),
          },
        },
      });

      if (added) toast.success(`${token.symbol} added to your wallet`);
      else toast.info("Token was not added");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      // User rejection is not an error worth shouting about.
      if (/reject|denied|cancel/i.test(msg)) toast.info("Cancelled");
      else toast.error(`Couldn't add token — make sure you're on ${CHAIN_LABEL}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={add}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3.5 py-2 text-xs font-medium text-[var(--muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--foreground)] disabled:opacity-60"
      >
        <Plus className="h-3.5 w-3.5" />
        Add {token.symbol} to wallet
      </button>
      {/* ⓘ — hover/focus tooltip explaining what the button does */}
      <span className="group relative inline-flex" tabIndex={0}>
        <Info
          aria-label={`What does "Add ${token.symbol} to wallet" do?`}
          className="h-3.5 w-3.5 cursor-help text-[var(--muted-2)] transition-colors group-hover:text-[var(--foreground)] group-focus-within:text-[var(--foreground)]"
        />
        <span
          role="tooltip"
          className="pointer-events-none invisible absolute bottom-full right-0 z-30 mb-2 w-60 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-left text-[11px] font-normal leading-relaxed text-[var(--muted)] opacity-0 shadow-xl transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
        >
          Registers {token.symbol} in your wallet&apos;s token list (MetaMask
          etc.) so your balance shows up. Free — nothing is sent on-chain;
          your wallet only asks you to confirm adding the token.
        </span>
      </span>
    </span>
  );
}
