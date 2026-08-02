// One-point perspective floor grid — radial lines + concentric rows receding
// to a central vanishing point. Drawn in currentColor so it reads as faint
// gray on light paper and faint white on the dark theme. Purely decorative.

const VP_X = 800;
const VP_Y = 450;
// fan endpoints along the top & bottom edges
const FAN_X = [-260, 40, 240, 440, 650, 950, 1160, 1360, 1560, 1860];

export function PerspectiveGrid() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 text-[var(--foreground)]"
      style={{
        maskImage:
          "radial-gradient(135% 105% at 50% 32%, #000 30%, transparent 80%)",
        WebkitMaskImage:
          "radial-gradient(135% 105% at 50% 32%, #000 30%, transparent 80%)",
      }}
    >
      <svg
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
      >
        <defs>
          <linearGradient id="ioi-grid-fade" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.16" />
            <stop offset="0.55" stopColor="currentColor" stopOpacity="0.07" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        <g stroke="url(#ioi-grid-fade)" strokeWidth="1" fill="none">
          {/* radial fan lines toward the bottom and top edges */}
          {FAN_X.map((x) => (
            <line key={`b${x}`} x1={VP_X} y1={VP_Y} x2={x} y2={900} />
          ))}
          {FAN_X.map((x) => (
            <line key={`t${x}`} x1={VP_X} y1={VP_Y} x2={x} y2={0} />
          ))}

          {/* horizon */}
          <line x1="0" y1={VP_Y} x2="1600" y2={VP_Y} />

          {/* concentric "ground" rows receding into the distance */}
          <rect x="700" y="430" width="200" height="40" />
          <rect x="600" y="410" width="400" height="80" />
          <rect x="450" y="380" width="700" height="140" />
          <rect x="250" y="340" width="1100" height="220" />
          <rect x="-50" y="280" width="1700" height="340" />
        </g>
      </svg>
    </div>
  );
}
