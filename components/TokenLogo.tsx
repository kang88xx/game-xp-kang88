import { getToken } from "@/lib/tokens";

export function TokenLogo({
  symbol,
  size = 32,
}: {
  symbol: string;
  size?: number;
}) {
  const token = getToken(symbol);
  const color = token?.color ?? "#71717a";
  const label = symbol.slice(0, symbol.length > 3 ? 2 : symbol.length);

  if (token?.logoUrl) {
    const scale = token.logoScale ?? 1;
    const inner = Math.round(size * scale);
    return (
      <span
        className="inline-flex items-center justify-center overflow-hidden rounded-full shrink-0"
        style={{
          width: size,
          height: size,
          background: token.logoTransparent ? "transparent" : color,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={token.logoUrl}
          alt={symbol}
          width={inner}
          height={inner}
          className="object-contain"
          style={{ width: inner, height: inner }}
        />
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0"
      style={{
        width: size,
        height: size,
        background: color,
        fontSize: size * 0.38,
        letterSpacing: "-0.02em",
      }}
      aria-hidden
    >
      {label}
    </span>
  );
}

export function TokenPair({
  token0,
  token1,
  size = 30,
}: {
  token0: string;
  token1: string;
  size?: number;
}) {
  return (
    <span className="inline-flex items-center" style={{ width: size * 1.6 }}>
      <span className="relative z-10 ring-2 ring-[var(--card)] rounded-full">
        <TokenLogo symbol={token0} size={size} />
      </span>
      <span className="-ml-2.5 ring-2 ring-[var(--card)] rounded-full">
        <TokenLogo symbol={token1} size={size} />
      </span>
    </span>
  );
}
