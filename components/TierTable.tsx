"use client";

// Timer Tiers — escalation ladder. Each tier's heat bar grows and shifts
// cream → ember → crimson, making the "stake ×2, timer ÷2" progression
// legible at a glance. The live tier row gets a ring + pulse dot.

// Mirrors KangLMS.betFloorForTier / durationForTier (row index === tier).
// Labels use human bet numbering: tier t covers on-chain betCount t*10..t*10+9,
// i.e. the (t*10+1)th through (t*10+10)th bet — "1st–10th", "11th–20th", …
const ROWS = [
  { bets: "1st–10th", bet: "1,000", timer: "24h" },
  { bets: "11th–20th", bet: "2,000", timer: "12h" },
  { bets: "21st–30th", bet: "4,000", timer: "6h" },
  { bets: "31st–40th", bet: "8,000", timer: "3h" },
  { bets: "41st–50th", bet: "16,000", timer: "1.5h" },
  { bets: "51st–60th", bet: "32,000", timer: "45m" },
  { bets: "61st–70th", bet: "64,000", timer: "22.5m" },
  { bets: "71st–80th", bet: "128,000", timer: "11.25m" },
  { bets: "81st–90th", bet: "256,000", timer: "5.6m" },
  { bets: "91st+", bet: "512,000+", timer: "min 30s" },
];

// cream → ember → crimson heat ramp across the 10 tiers
const heat = (t: number) => {
  const stops = [
    "#ffeed4", "#ffd9a8", "#ffbe7a", "#ffa24f", "#ff9738",
    "#f97a2e", "#ef5c28", "#e7453a", "#cf1512", "#a90120",
  ];
  return stops[Math.min(t, stops.length - 1)];
};

export function TierTable({ tier }: { tier: number }) {
  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 sm:p-6">
      <div className="mb-3 text-sm font-semibold">
        Timer Tiers
        <span className="ml-1 font-normal text-[var(--muted-2)]">
          · every 10 bets the stake doubles and the clock halves
        </span>
      </div>
      <div className="space-y-1">
        {ROWS.map((r, t) => {
          const active = t === tier;
          return (
            <div
              key={r.bets}
              className={`relative overflow-hidden rounded-lg px-3 py-1.5 text-xs tabular-nums ${
                active ? "tier-live" : ""
              }`}
            >
              {/* heat bar — width doubles the feeling of escalation */}
              <div
                aria-hidden
                className="absolute inset-y-0 left-0 rounded-lg opacity-[0.16]"
                style={{
                  width: `${((t + 1) / ROWS.length) * 100}%`,
                  background: heat(t),
                }}
              />
              <div className="relative flex items-center justify-between gap-2">
                <span className="flex w-[38%] items-center gap-2">
                  <span
                    className="inline-flex h-4 w-7 items-center justify-center rounded font-mono text-[10px] font-bold text-black/80"
                    style={{ background: heat(t) }}
                  >
                    T{t}
                  </span>
                  <span
                    className={
                      active
                        ? "font-semibold text-[var(--foreground)]"
                        : "text-[var(--muted)]"
                    }
                  >
                    {r.bets} bet
                  </span>
                  {active && (
                    <span className="dot-live h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                  )}
                </span>
                <span
                  className={`w-[38%] text-right font-mono ${
                    active
                      ? "font-semibold text-[var(--foreground)]"
                      : "text-[var(--muted)]"
                  }`}
                >
                  {r.bet} KANGTEST1
                </span>
                <span
                  className={`w-[24%] text-right font-mono ${active ? "font-semibold" : ""}`}
                  style={{ color: heat(t) }}
                >
                  {r.timer}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
