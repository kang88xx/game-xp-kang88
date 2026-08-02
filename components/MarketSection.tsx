"use client";

import { useState } from "react";
import { type ChartRange } from "@/lib/mock-data";
import { useMarketTokens } from "@/lib/market";
import { formatCompact, formatPercent, formatUsd } from "@/lib/format";
import { TokenLogo } from "@/components/TokenLogo";
import { PriceChart, Sparkline } from "@/components/PriceChart";
import { AddToWalletButton } from "@/components/AddToWalletButton";
import { Eyebrow } from "@/components/ui";

export function MarketSection({
  chartSymbol,
  onTokenSelect,
}: {
  /** Controlled chart token (e.g. the swap's receive side). */
  chartSymbol?: string;
  /** Called when a token row is clicked — overrides the local selection. */
  onTokenSelect?: (symbol: string) => void;
} = {}) {
  const [localSelected, setLocalSelected] = useState("XP");
  const selected = chartSymbol ?? localSelected;
  const select = (symbol: string) => {
    if (onTokenSelect) onTokenSelect(symbol);
    else setLocalSelected(symbol);
  };
  const [range, setRange] = useState<ChartRange>("1M");
  const tokens = useMarketTokens();
  // Selected token may have been disabled by the admin — fall back to the
  // first enabled one; with everything disabled there is nothing to show.
  const token = tokens.find((t) => t.symbol === selected) ?? tokens[0];
  if (!token) return null;

  return (
    <div>
      <Eyebrow dot="cyan" className="mb-4">
        Market
      </Eyebrow>

      {/* Chart card */}
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <TokenLogo symbol={token.symbol} size={22} />
              <h2 className="text-base font-semibold">{token.name}</h2>
              <span className="text-sm text-[var(--muted)]">
                {token.symbol}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold tracking-tight">
                {formatUsd(token.priceUsd)}
              </span>
              <span
                className="text-sm font-medium"
                style={{
                  color: token.change24h >= 0 ? "var(--up)" : "var(--down)",
                }}
              >
                {formatPercent(token.change24h)}
              </span>
            </div>
          </div>

          {/* Stats — aligned to the right end of the header */}
          <div className="flex items-start gap-6 sm:gap-8">
            <Metric
              label="Market cap"
              value={formatUsd(token.marketCap, { compact: true })}
            />
            <Metric
              label="24h volume"
              value={formatUsd(token.volume24h, { compact: true })}
            />
            <div className="flex flex-col items-start gap-1.5">
              <Metric
                label="Contract"
                value={token.address ? `${token.address.slice(0, 8)}…` : "Native"}
                mono
                small
              />
              <AddToWalletButton symbol={token.symbol} />
            </div>
          </div>
        </div>

        <div className="mt-4">
          <PriceChart
            symbol={selected}
            range={range}
            onRangeChange={setRange}
            height={240}
          />
        </div>
      </div>

      {/* Token table */}
      <div className="mt-6 overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--card)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
              <th className="px-5 py-3 font-medium">#</th>
              <th className="px-2 py-3 font-medium">Token</th>
              <th className="px-2 py-3 text-right font-medium">Price</th>
              <th className="px-2 py-3 text-right font-medium">24h</th>
              <th className="hidden px-2 py-3 text-right font-medium sm:table-cell">
                Volume
              </th>
              <th className="hidden px-2 py-3 text-right font-medium md:table-cell">
                Market cap
              </th>
              <th className="hidden px-5 py-3 text-right font-medium sm:table-cell">
                7d
              </th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t, i) => (
              <tr
                key={t.symbol}
                onClick={() => select(t.symbol)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    select(t.symbol);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`View ${t.name} chart`}
                aria-pressed={selected === t.symbol}
                className={`cursor-pointer border-b border-[var(--border)] outline-none transition-colors last:border-0 hover:bg-[var(--surface)] focus-visible:bg-[var(--surface)] ${
                  selected === t.symbol ? "bg-[var(--accent-soft)]" : ""
                }`}
              >
                <td className="px-5 py-3 text-[var(--muted)]">{i + 1}</td>
                <td className="px-2 py-3">
                  <div className="flex items-center gap-2.5">
                    <TokenLogo symbol={t.symbol} size={32} />
                    <div>
                      <div className="font-semibold">{t.symbol}</div>
                      <div className="text-xs text-[var(--muted)]">{t.name}</div>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-3 text-right font-medium">
                  {formatUsd(t.priceUsd)}
                </td>
                <td
                  className="px-2 py-3 text-right font-medium"
                  style={{
                    color: t.change24h >= 0 ? "var(--up)" : "var(--down)",
                  }}
                >
                  {formatPercent(t.change24h)}
                </td>
                <td className="hidden px-2 py-3 text-right text-[var(--muted)] sm:table-cell">
                  ${formatCompact(t.volume24h)}
                </td>
                <td className="hidden px-2 py-3 text-right text-[var(--muted)] md:table-cell">
                  ${formatCompact(t.marketCap)}
                </td>
                <td className="hidden px-5 py-3 sm:table-cell">
                  <div className="flex justify-end">
                    <Sparkline
                      symbol={t.symbol}
                      data={t.spark7d}
                      up={t.change24h >= 0}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  mono,
  small,
}: {
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div
        className={`mt-0.5 font-semibold ${mono ? "font-mono" : ""} ${
          small ? "text-xs" : mono ? "text-sm" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
