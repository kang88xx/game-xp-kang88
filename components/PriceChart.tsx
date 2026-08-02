"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getPriceHistory, type ChartRange } from "@/lib/mock-data";
import { usePriceHistory, useTokenMarket } from "@/lib/market";
import { formatUsd } from "@/lib/format";

const RANGES: ChartRange[] = ["1D", "1W", "1M", "1Y"];

/** Compact axis tick for prices — fewer decimals for big values, more for sub-$1. */
function axisPrice(v: number): string {
  if (v >= 1000) return formatUsd(v, { compact: true });
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toPrecision(2)}`;
}

/** Round a raw step up to a "nice" 1/2/2.5/5/10 × 10ⁿ value. */
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

/**
 * Even, round-number Y ticks. Aligns the domain to the step so every tick
 * sits at a clean unit and the gaps are identical.
 */
function niceTicks(min: number, max: number, count = 5): { domain: [number, number]; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    const c = Number.isFinite(min) ? min : 0;
    const pad = Math.abs(c) * 0.05 || 1;
    min = c - pad;
    max = c + pad;
  }
  const step = niceStep((max - min) / Math.max(1, count - 1));
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return { domain: [lo, hi], ticks };
}

/** Axis label for the X tick — clamps minutes to :00 on the intraday view. */
function xTickLabel(label: string | undefined, range: ChartRange): string {
  if (!label) return "";
  if (range === "1D" && label.includes(":")) {
    const [h, m] = label.split(":").map(Number);
    const hour = (((h + (m >= 30 ? 1 : 0)) % 24) + 24) % 24;
    return `${String(hour).padStart(2, "0")}:00`;
  }
  return label;
}

export function PriceChart({
  symbol,
  range,
  onRangeChange,
  height = 280,
  showRanges = true,
}: {
  symbol: string;
  range: ChartRange;
  onRangeChange?: (r: ChartRange) => void;
  height?: number;
  showRanges?: boolean;
}) {
  const { change24h } = useTokenMarket(symbol);
  const { data, isLoading } = usePriceHistory(symbol, range);
  const up = change24h >= 0;
  const stroke = up ? "var(--up)" : "var(--down)";
  const gradId = `grad-${symbol}-${range}`;

  const prices = data.map((d) => d.price);
  const min = prices.length ? Math.min(...prices) : 0;
  const max = prices.length ? Math.max(...prices) : 0;
  // Even, round-number Y ticks; domain snaps to the step so gaps are equal.
  const { domain: yDomain, ticks: yTicks } = niceTicks(min, max, 5);
  // Evenly-spaced X ticks by index (linear axis → identical pixel gaps).
  const xCount = Math.min(6, data.length);
  const xTicks =
    data.length <= 1
      ? [0]
      : Array.from({ length: xCount }, (_, k) => (k * (data.length - 1)) / (xCount - 1));

  return (
    <div>
      {showRanges && onRangeChange && (
        <div className="mb-3 flex justify-end">
          <div className="inline-flex rounded-full border border-[var(--border)] p-0.5">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => onRangeChange(r)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  r === range
                    ? "bg-[var(--surface-2)] text-[var(--foreground)]"
                    : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}
      {isLoading || data.length === 0 ? (
        <div
          className="animate-pulse-soft rounded-2xl bg-[var(--surface-2)]"
          style={{ height }}
        />
      ) : (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.18} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="var(--border)"
            strokeDasharray="3 3"
          />
          <XAxis
            dataKey="t"
            type="number"
            domain={[0, Math.max(0, data.length - 1)]}
            ticks={xTicks}
            interval={0}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            tickMargin={8}
            tickFormatter={(i) => xTickLabel(data[Math.round(Number(i))]?.label, range)}
          />
          <YAxis
            domain={yDomain}
            ticks={yTicks}
            interval={0}
            orientation="right"
            width={56}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => axisPrice(Number(v))}
          />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeDasharray: "3 3" }}
            contentStyle={{
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--card)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--muted)" }}
            itemStyle={{ color: "var(--foreground)" }}
            labelFormatter={(l) => data[Number(l)]?.label ?? ""}
            formatter={(v) => [formatUsd(Number(v)), "Price"] as [string, string]}
          />
          <Area
            type="monotone"
            dataKey="price"
            stroke={stroke}
            strokeWidth={2}
            fill={`url(#${gradId})`}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
      )}
    </div>
  );
}

/** Tiny inline sparkline for table rows (live 7d data, mock for unlisted) */
export function Sparkline({
  symbol,
  data: spark,
  up,
}: {
  symbol: string;
  data: number[];
  up: boolean;
}) {
  const data =
    spark.length > 0
      ? spark.map((price, i) => ({ t: i, price }))
      : getPriceHistory(symbol, "1W");
  return (
    <ResponsiveContainer width={88} height={36}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id={`spark-${symbol}`} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor={up ? "var(--up)" : "var(--down)"}
              stopOpacity={0.25}
            />
            <stop
              offset="100%"
              stopColor={up ? "var(--up)" : "var(--down)"}
              stopOpacity={0}
            />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="price"
          stroke={up ? "var(--up)" : "var(--down)"}
          strokeWidth={1.5}
          fill={`url(#spark-${symbol})`}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
