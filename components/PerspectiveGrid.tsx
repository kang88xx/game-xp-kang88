// Pharos signature: ground-plane vanishing-point grid drawn behind the hero.
// Pure SVG, theme-aware via the --grid-line token, animated draw-in
// (`.pgrid` in globals.css), and faded out toward the bottom with a mask.

const VP = { x: 600, y: 108 }; // vanishing point — sits in the hero whitespace

// Perimeter targets the rays radiate to (beyond the viewBox so edges stay
// covered at any aspect ratio).
const RAY_TARGETS: [number, number][] = [
  // bottom spread
  [-240, 560], [-40, 560], [160, 560], [360, 560], [520, 560], [680, 560],
  [840, 560], [1040, 560], [1240, 560], [1440, 560],
  // sides
  [-240, 320], [1440, 320], [-240, 80], [1440, 80],
  // upper fan
  [-80, -60], [240, -60], [520, -60], [760, -60], [1000, -60], [1320, -60],
];

// Ember sparks (stake.x-phere.com motif) — position %, delay s, duration s,
// size px, color token, launch height px. Staggered delays + varied launch
// heights keep several sparks mid-flight (visible) at any moment.
const EMBERS: [number, number, number, number, string, number][] = [
  [4, 0.8, 7.5, 4, "var(--dot-yellow)", 90],
  [12, 0, 7, 5, "var(--accent-bright)", 0],
  [19, 3.2, 6, 3, "var(--accent)", 150],
  [26, 1.8, 8.5, 4, "var(--dot-yellow)", 40],
  [33, 4.4, 7, 5, "var(--accent-bright)", 110],
  [41, 0.4, 6.5, 3, "var(--accent)", 0],
  [47, 2.6, 7.5, 5, "var(--accent-bright)", 130],
  [54, 5.1, 9, 4, "var(--dot-yellow)", 60],
  [60, 1.3, 6, 4, "var(--accent)", 100],
  [67, 3.9, 8, 5, "var(--accent-bright)", 20],
  [73, 0.9, 7, 3, "var(--dot-yellow)", 140],
  [79, 2.2, 6.5, 4, "var(--accent)", 70],
  [85, 4.7, 8.5, 5, "var(--accent-bright)", 0],
  [91, 1.6, 7.5, 3, "var(--dot-yellow)", 120],
  [96, 3.4, 6.5, 4, "var(--accent)", 50],
];

export function PerspectiveGrid({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] overflow-hidden ${className}`}
      style={{
        maskImage:
          "linear-gradient(to bottom, black 55%, transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to bottom, black 55%, transparent 100%)",
      }}
    >
      {EMBERS.map(([left, delay, dur, size, color, rise], i) => (
        <span
          key={i}
          className="ember"
          style={{
            left: `${left}%`,
            bottom: rise,
            width: size,
            height: size,
            background: color,
            animationDelay: `${delay}s`,
            animationDuration: `${dur}s`,
          }}
        />
      ))}
      <svg
        className="pgrid h-full w-full"
        viewBox="0 0 1200 520"
        preserveAspectRatio="xMidYMin slice"
        fill="none"
      >
        <g stroke="var(--grid-line)" strokeWidth="1">
          {RAY_TARGETS.map(([x, y], i) => (
            <line
              key={i}
              x1={VP.x}
              y1={VP.y}
              x2={x}
              y2={y}
              pathLength={1}
              style={{ animationDelay: `${i * 35}ms` }}
            />
          ))}
          {/* concentric frames — the faint rectangles from the reference */}
          <rect x="290" y="240" width="620" height="230" pathLength={1} />
          <rect x="440" y="205" width="320" height="130" pathLength={1} />
        </g>
        {/* corner-dot motif: a tiny sun at the vanishing point */}
        <rect
          x={VP.x - 3}
          y={VP.y - 3}
          width="6"
          height="6"
          fill="var(--dot-yellow)"
        />
      </svg>
    </div>
  );
}
