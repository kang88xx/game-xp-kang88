// Formatting helpers

export function formatUsd(value: number, opts?: { compact?: boolean }): string {
  if (!isFinite(value)) return "$0";
  if (opts?.compact && Math.abs(value) >= 1000) {
    return (
      "$" +
      Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 2,
      }).format(value)
    );
  }
  const digits = Math.abs(value) >= 1 ? 2 : 6;
  return (
    "$" +
    Intl.NumberFormat("en-US", {
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: digits,
    }).format(value)
  );
}

export function formatNumber(value: number, maxFrac = 4): string {
  if (!isFinite(value)) return "0";
  return Intl.NumberFormat("en-US", {
    maximumFractionDigits: maxFrac,
  }).format(value);
}

export function formatCompact(value: number): string {
  return Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Format a numeric INPUT string with thousand separators on the integer part,
 * while preserving the decimal portion and in-progress typing (e.g. a trailing
 * dot). Non-numeric characters are stripped. Pair with `parseAmountInput` to
 * recover the raw value for calculations.
 *
 *   "10000000"   -> "10,000,000"
 *   "1234.5"     -> "1,234.5"
 *   "1000."      -> "1,000."      (mid-typing)
 *   ""           -> ""
 */
export function formatAmountInput(raw: string): string {
  const s = String(raw ?? "").replace(/[^\d.]/g, "");
  const dot = s.indexOf(".");
  let intPart: string;
  let decPart: string | null;
  if (dot === -1) {
    intPart = s;
    decPart = null;
  } else {
    intPart = s.slice(0, dot);
    decPart = s.slice(dot + 1).replace(/\./g, ""); // drop any extra dots
  }
  intPart = intPart.replace(/^0+(?=\d)/, ""); // trim leading zeros (keep a lone 0)
  const intFmt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (decPart === null) return intFmt;
  return (intFmt || "0") + "." + decPart;
}

/** Strip thousand separators from a formatted input back to a raw numeric string. */
export function parseAmountInput(formatted: string): string {
  return String(formatted ?? "").replace(/,/g, "");
}

export function formatPercent(value: number, withSign = true): string {
  const sign = withSign && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function shortAddress(addr?: string | null): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Impure — reads Date.now() internally. Do NOT call in render; use timeAgoPure instead.
export function timeAgo(ts: number): string {
  return timeAgoPure(ts, Date.now());
}

export function timeAgoPure(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// Reading the clock lives in a helper so callers stay free of impure
// `Date.now()` calls in their render bodies (React 19 purity rule).
export function isPast(ts: number): boolean {
  return ts <= Date.now();
}

export function daysUntil(ts: number): string {
  const diff = ts - Date.now();
  if (diff <= 0) return "Ended";
  const d = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (d >= 1) return `${d}d left`;
  const h = Math.floor(diff / (1000 * 60 * 60));
  return `${h}h left`;
}
