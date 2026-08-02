"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useTokenRegistry } from "@/lib/token-registry";
import { useBalances } from "@/lib/balances";
import { useMarket } from "@/lib/market";
import { formatNumber, formatUsd } from "@/lib/format";
import { TokenLogo } from "./TokenLogo";

export function TokenSelectModal({
  open,
  onClose,
  onSelect,
  exclude,
  tradableOnly,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (symbol: string) => void;
  exclude?: string;
  /** Hide tokens without a swappable Xphere contract */
  tradableOnly?: boolean;
}) {
  const [query, setQuery] = useState("");
  const balances = useBalances();
  const market = useMarket();
  const { enabled, tradable } = useTokenRegistry();
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus trap: keep keyboard focus inside the dialog while it is open,
  // cycle Tab/Shift+Tab within it, and restore focus to the trigger on close.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null)
        : [];

    // move focus into the dialog (prefer the search field)
    const searchInput = panel?.querySelector<HTMLInputElement>("input");
    (searchInput ?? focusable()[0])?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusable();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const source = tradableOnly ? tradable : enabled;
  const filtered = source.filter((t) => {
    if (t.symbol === exclude) return false;
    const q = query.toLowerCase();
    return (
      t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
    );
  });

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/40 p-4 pt-24">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Select a token"
        className="animate-fade-in relative w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 pt-5">
          <h3 className="text-base font-semibold">Select a token</h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--surface)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pt-4">
          <div className="flex items-center gap-2 rounded-2xl border border-[var(--border-strong)] px-3.5 py-2.5">
            <Search className="h-4 w-4 text-[var(--muted)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or symbol"
              className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted-2)]"
            />
          </div>
        </div>

        <div className="mt-3 max-h-80 overflow-y-auto px-2 pb-3">
          {filtered.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-[var(--muted)]">
              No tokens found
            </p>
          )}
          {filtered.map((t) => {
            const bal = balances[t.symbol] ?? 0;
            return (
              <button
                key={t.symbol}
                onClick={() => {
                  onSelect(t.symbol);
                  onClose();
                  setQuery("");
                }}
                className="flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface)]"
              >
                <span className="flex items-center gap-3">
                  <TokenLogo symbol={t.symbol} size={36} />
                  <span>
                    <span className="block text-sm font-semibold">
                      {t.symbol}
                    </span>
                    <span className="block text-xs text-[var(--muted)]">
                      {t.name}
                    </span>
                  </span>
                </span>
                {bal > 0 && (
                  <span className="text-right">
                    <span className="block text-sm font-medium">
                      {formatNumber(bal, 4)}
                    </span>
                    <span className="block text-xs text-[var(--muted)]">
                      {formatUsd(bal * (market[t.symbol]?.priceUsd ?? t.priceUsd))}
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
