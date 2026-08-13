"use client";

// Timer Tiers — escalation ladder. Each tier's heat bar grows and shifts
// cream → ember → crimson, making the "stake ×2, timer ÷2" progression
// legible at a glance. The live tier row gets a ring + pulse dot.

// Mirrors KangLMS.betFloorForTier / durationForTier (row index === tier).
const ROWS = [
  { bets: "0–9", bet: "1,000", timer: "24h" },
  { bets: "10–19", bet: "2,000", timer: "12h" },
  { bets: "20–29", bet: "4,000", timer: "6h" },
  { bets: "30–39", bet: "8,000", timer: "3h" },
  { bets: "40–49", bet: "16,000", timer: "1.5h" },
  { bets: "50–59", bet: "32,000", timer: "45m" },
  { bets: "60–69", bet: "64,000", timer: "22.5m" },
  { bets: "70–79", bet: "128,000", timer: "11.25m" },
  { bets: "80–89", bet: "256,000", timer: "5.6m" },
  { bets: "90+", bet: "512,000+", timer: "min 30s" },
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
                active ? "ring-1 ring-[var(--accent)]" : ""
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
                    {r.bets} bets
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
                  {r.bet} KDG
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
