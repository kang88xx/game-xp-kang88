import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { TradeBoard } from "@/components/TradeBoard";
import { PerspectiveGrid } from "@/components/PerspectiveGrid";
import { POOLS } from "@/lib/mock-data";
import { CHAIN_LABEL } from "@/lib/chain";
import { formatUsd } from "@/lib/format";

// Ticker stats derived from the app's own liquidity-pool registry (not
// hardcoded). When real on-chain pools ship, these follow automatically.
const TVL_USD = POOLS.reduce((sum, p) => sum + p.tvlUsd, 0);
const VOL_24H_USD = POOLS.reduce((sum, p) => sum + p.volume24h, 0);
const PAIR_COUNT = POOLS.length;

export default function Home() {
  return (
    <>
      {/* Slim status bar under the header */}
      <section className="relative overflow-hidden border-b border-[var(--border)]">
        <PerspectiveGrid />
        <div className="relative z-10 mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.06em] text-[var(--muted)]">
              <span className="h-1.5 w-1.5 bg-[var(--dot-yellow)]" />
              Live on {CHAIN_LABEL}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-2)]">
              Innovate · Own · Inspire
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-x-5">
              <InlineStat
                label="24h Vol"
                value={formatUsd(VOL_24H_USD, { compact: true })}
              />
              <span className="text-[var(--border-strong)]">·</span>
              <InlineStat
                label="TVL"
                value={formatUsd(TVL_USD, { compact: true })}
              />
              <span className="text-[var(--border-strong)]">·</span>
              <InlineStat label="Pairs" value={String(PAIR_COUNT)} />
            </div>
            <Link
              href="/airdrop"
              className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)] py-1 pl-3 pr-2 text-xs font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
            >
              Claim airdrop
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* Swap + Market — shared pair state (chart follows the buy side) */}
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <TradeBoard />
      </div>
    </>
  );
}

function InlineStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="tabular text-sm font-semibold">{value}</span>
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--muted)]">
        {label}
      </span>
    </span>
  );
}
