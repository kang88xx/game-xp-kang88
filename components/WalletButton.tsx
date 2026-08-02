"use client";

import { useState } from "react";
import { Copy, LogOut, Check, Wallet } from "lucide-react";
import { useAppKit } from "@reown/appkit/react";
import { useDisconnect } from "wagmi";
import { useDexStore, useHydrated } from "@/lib/store";
import { shortAddress } from "@/lib/format";
import { toast } from "./toast";
import { ArrowChip } from "./ui";

export function WalletButton() {
  const hydrated = useHydrated();
  const connected = useDexStore((s) => s.connected);
  const address = useDexStore((s) => s.address);
  const { open } = useAppKit();
  const { disconnect } = useDisconnect();

  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!hydrated) {
    return (
      <div className="h-9 w-32 rounded-full bg-[var(--surface-2)] animate-pulse-soft" />
    );
  }

  if (!connected) {
    return (
      <button
        onClick={() => open()}
        className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] py-1.5 pl-4 pr-1.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
      >
        Connect Wallet
        <ArrowChip variant="onAccent" />
      </button>
    );
  }

  const copy = () => {
    if (address) navigator.clipboard?.writeText(address);
    setCopied(true);
    toast.info("Address copied");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--card)] px-3 py-2 text-sm font-medium transition-colors hover:bg-[var(--surface)]"
      >
        <span className="h-2 w-2 rounded-full bg-[var(--up)]" />
        <span className="font-mono">{shortAddress(address)}</span>
      </button>

      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenuOpen(false)}
          />
          <div className="animate-fade-in absolute right-0 top-12 z-50 w-56 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-xl shadow-black/5">
            <div className="px-3 py-2">
              <p className="text-xs text-[var(--muted)]">Connected wallet</p>
              <p className="font-mono text-sm">{shortAddress(address)}</p>
            </div>
            <div className="h-px bg-[var(--border)] my-1" />
            <button
              onClick={copy}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-[var(--surface)]"
            >
              {copied ? (
                <Check className="h-4 w-4 text-[var(--up)]" />
              ) : (
                <Copy className="h-4 w-4 text-[var(--muted)]" />
              )}
              Copy address
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                open({ view: "Account" });
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-[var(--surface)]"
            >
              <Wallet className="h-4 w-4 text-[var(--muted)]" />
              Wallet details
            </button>
            <button
              onClick={() => {
                disconnect();
                setMenuOpen(false);
                toast.info("Wallet disconnected");
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-[var(--down)] transition-colors hover:bg-[var(--down-soft)]"
            >
              <LogOut className="h-4 w-4" />
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}
