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
