"use client";

import { useMetaMask } from "@/lib/use-metamask";
import {
  ArrowLeftRight,
  Coins,
  Gift,
  Wallet,
  PlusCircle,
  MinusCircle,
} from "lucide-react";
import { TOKEN_MAP } from "@/lib/mock-data";
import { useDexStore, useHydrated } from "@/lib/store";
import { useBalances } from "@/lib/balances";
import { useMarket } from "@/lib/market";
import {
  formatNumber,
  formatPercent,
  formatUsd,
  shortAddress,
  timeAgo,
} from "@/lib/format";
import { TokenLogo } from "@/components/TokenLogo";
import { Eyebrow } from "@/components/ui";
import type { TxType } from "@/lib/types";

const TX_ICON: Record<TxType, React.ReactNode> = {
  swap: <ArrowLeftRight className="h-4 w-4" />,
  "add-liquidity": <PlusCircle className="h-4 w-4" />,
  "remove-liquidity": <MinusCircle className="h-4 w-4" />,
  claim: <Gift className="h-4 w-4" />,
  bet: <Coins className="h-4 w-4" />,
};

export default function PortfolioPage() {
  const hydrated = useHydrated();
  const connected = useDexStore((s) => s.connected);
  const address = useDexStore((s) => s.address);
  const { open: openWalletModal } = useMetaMask();
  const balances = useBalances();
  const market = useMarket();
  const allTransactions = useDexStore((s) => s.transactions);
  const transactions = allTransactions.filter((t) => t.address === address);

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="h-40 rounded-3xl bg-[var(--surface-2)] animate-pulse-soft" />
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-soft)]">
          <Wallet className="h-7 w-7 text-[var(--accent)]" />
        </span>
        <h1 className="mt-5 text-xl font-bold">Connect your wallet</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Connect to view your balances and activity.
        </p>
        <button
          onClick={() => openWalletModal()}
          className="mt-6 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  const tokenRows = Object.entries(balances)
    .map(([symbol, amount]) => {
      const t = TOKEN_MAP[symbol];
      const m = market[symbol];
      const price = m?.priceUsd ?? t?.priceUsd ?? 0;
      const change = m?.change24h ?? t?.change24h ?? 0;
      return { symbol, amount, token: t, price, change, value: amount * price };
    })
    .filter((r) => r.amount > 0.000001)
    .sort((a, b) => b.value - a.value);

  const tokenValue = tokenRows.reduce((s, r) => s + r.value, 0);
  const totalValue = tokenValue;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Eyebrow dot="blue" className="mb-4">
        Portfolio
      </Eyebrow>
      {/* Header / total */}
      <div className="rounded-3xl border border-[var(--border)] bg-gradient-to-br from-[var(--card)] to-[var(--surface)] p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-[var(--muted)]">Total balance</p>
            <p className="mt-1 text-4xl font-bold tracking-tight">
              {formatUsd(totalValue)}
            </p>
            <p className="mt-2 font-mono text-xs text-[var(--muted)]">
              {shortAddress(address)}
            </p>
          </div>
          <div className="flex gap-6">
            <SummaryStat label="Tokens" value={formatUsd(tokenValue)} />
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        {/* Holdings */}
        <div className="lg:col-span-3">
          <h2 className="mb-3 text-sm font-semibold">Holdings</h2>
          <div className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--card)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                  <th className="px-5 py-3 font-medium">Token</th>
                  <th className="px-2 py-3 text-right font-medium">Balance</th>
                  <th className="px-2 py-3 text-right font-medium">Price</th>
                  <th className="px-5 py-3 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {tokenRows.map((r) => (
                  <tr
                    key={r.symbol}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <TokenLogo symbol={r.symbol} size={32} />
                        <div>
                          <div className="font-semibold">{r.symbol}</div>
                          <div className="text-xs text-[var(--muted)]">
                            {r.token?.name}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-3 text-right font-medium">
                      {formatNumber(r.amount, 4)}
                    </td>
                    <td className="px-2 py-3 text-right text-[var(--muted)]">
                      {formatUsd(r.price)}
                      <span
                        className="ml-1 text-xs"
                        style={{
                          color: r.change >= 0 ? "var(--up)" : "var(--down)",
                        }}
                      >
                        {formatPercent(r.change, false)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right font-semibold">
                      {formatUsd(r.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </div>

        {/* Activity */}
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Recent activity</h2>
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-2">
            {transactions.length === 0 ? (
              <p className="py-10 text-center text-sm text-[var(--muted)]">
                No activity yet
              </p>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {transactions.map((tx) => (
                  <div key={tx.id} className="flex items-start gap-3 p-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--muted)]">
                      {TX_ICON[tx.type]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug">{tx.summary}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        {timeAgo(tx.timestamp)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
