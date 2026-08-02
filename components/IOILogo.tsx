// IOI brand mark — the X-glyph: a triple-stroke prism in blue / orange / cyan.
// Brand colors are fixed (not theme-dependent).

export function GlyphX({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect
        x="10"
        y="42"
        width="80"
        height="16"
        fill="#1A1AEE"
        transform="rotate(28 50 50)"
      />
      <rect
        x="10"
        y="42"
        width="80"
        height="16"
        fill="#FF5722"
        transform="rotate(-28 50 50)"
      />
      <rect
        x="10"
        y="42"
        width="80"
        height="16"
        fill="#3DBEFF"
        transform="rotate(72 50 50)"
        opacity="0.85"
      />
    </svg>
  );
}

export function IOILockup({ size = 24 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <GlyphX size={size + 6} />
      <span
        className="font-semibold tracking-[0.22em]"
        style={{ fontSize: size }}
      >
        IOI
      </span>
    </span>
  );
}
