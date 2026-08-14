"use client";

import { useEffect, useState } from "react";
import { Copy, LogOut, Check } from "lucide-react";
import { useDisconnect } from "wagmi";
import { useMetaMask } from "@/lib/use-metamask";
import { useZigapAccount } from "@/lib/zigap";
import { useDexStore, useHydrated } from "@/lib/store";
import { shortAddress } from "@/lib/format";
import { toast } from "./toast";
import { AddNetworkButton } from "./AddNetworkButton";

export function WalletButton() {
  const hydrated = useHydrated();
  const connected = useDexStore((s) => s.connected);
  const address = useDexStore((s) => s.address);
  const { open } = useMetaMask();
  const { disconnect } = useDisconnect();
  const zigap = useZigapAccount();

  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Close the account menu on Escape (mobile browsers included).
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  if (!hydrated) {
    return (
      <div className="h-9 w-32 rounded-full bg-[var(--surface-2)] animate-pulse-soft" />
    );
  }

  if (!connected) {
    return (
      <button
        onClick={() => open()}
        className="wallet-connect group inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold"
      >
        <span className="wc-dot" />
        Connect Wallet
        {/* bare diagonal arrow — no chip plate */}
        <svg
          className="transition-transform duration-150 ease-out group-hover:translate-x-[1.5px] group-hover:-translate-y-[1.5px]"
          width="15"
          height="15"
          viewBox="0 0 16 16"
          fill="none"
        >
          <path
            d="M5 11 L11 5 M6 5 H11 V10"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="square"
          />
        </svg>
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
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--card)] px-3 py-2 text-sm font-medium transition-colors hover:bg-[var(--surface)]"
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
              className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-sm transition-colors hover:bg-[var(--surface)]"
            >
              {copied ? (
                <Check className="h-4 w-4 text-[var(--up)]" />
              ) : (
                <Copy className="h-4 w-4 text-[var(--muted)]" />
              )}
              Copy address
            </button>
            <AddNetworkButton variant="menu" />
            <button
              onClick={() => {
                disconnect();
                // ZIGAP 딥링크 세션도 함께 끊는다 (있을 때만 의미 있음).
                if (zigap.address) zigap.logout();
                setMenuOpen(false);
                toast.info("Wallet disconnected");
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-sm text-[var(--down)] transition-colors hover:bg-[var(--down-soft)]"
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
