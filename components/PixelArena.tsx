"use client";

// Gold Babel pixel arena — an animated pixel-art scene for the LMS game,
// reimplemented from the pumpkinswap LMS arena (same palette + stage skies).
// The Babel tower grows with the round's bet count and the sky darkens with
// the tier (DAWN → DUSK → NIGHT → DEEP NIGHT → WITCHING → INFERNO). Driven by
// our live game state; rendered at a low internal resolution and scaled up
// with `image-rendering: pixelated` for the crisp pixel look.
import { useEffect, useRef } from "react";

// Internal pixel-grid resolution (scaled up by CSS). 8:5 landscape.
const W = 256;
const H = 160;

// Dark-theme palette (matches pumpkinswap's arena `v`).
const P = {
  ground: "#1E2333",
  groundDark: "#12151F",
  stone: "#2A3042",
  stoneDark: "#1A1E2C",
  wood: "#6B4423",
  woodDark: "#3F2814",
  gold: "#E8A33C",
  goldDark: "#8A5A1E",
  flame: "#E8A33C",
  flameHot: "#FFE066",
  flameCool: "#C03A3A",
  ruby: "#D14A6B",
  star: "#FFE9A8",
  inkSoft: "#B5B9C2",
  smoke: "#5A6072",
};

// Per-tier sky gradients (top → horizon), from the LMS stage table.
const SKY_STAGES = [
  ["#1A2540", "#3E4B73", "#6B5D7F", "#C98E7E"], // DAWN
  ["#0F1A2E", "#2A2F55", "#513361", "#8C3A4C"], // DUSK
  ["#060913", "#0F1530", "#241A3E", "#3B1F3F"], // NIGHT
  ["#02030A", "#07101E", "#15122D", "#3B1C2F"], // DEEP NIGHT
  ["#010107", "#050815", "#1A0D2E", "#4A1C2A"], // WITCHING
  ["#1A0404", "#2E0510", "#5A0E1E", "#8A1A2A"], // INFERNO
];

// Deterministic per-index pseudo-random in [0,1) — stable star/particle seeds.
function rand(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function px(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function shortAddr(a?: string | null): string {
  return a ? `${a.slice(2, 6)}…${a.slice(-4)}`.toUpperCase() : "—";
}

export interface ArenaState {
  tier: number;
  betCount: number;
  lastBettor?: string | null;
  active?: boolean;
}

export function PixelArena({
  tier,
  betCount,
  lastBettor,
  active = true,
  className,
}: ArenaState & { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Keep latest state in a ref so the rAF loop reads fresh values without
  // restarting on every prop change.
  const stateRef = useRef<ArenaState>({ tier, betCount, lastBettor, active });
  useEffect(() => {
    stateRef.current = { tier, betCount, lastBettor, active };
  }, [tier, betCount, lastBettor, active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = W;
    canvas.height = H;
    let raf = 0;
    const start = performance.now();
    const groundY = H - 30;

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      const s = stateRef.current;
      const stage = Math.max(0, Math.min(5, s.tier));
      const sky = SKY_STAGES[stage];

      // Sky gradient.
      const g = ctx.createLinearGradient(0, 0, 0, groundY);
      g.addColorStop(0, sky[0]);
      g.addColorStop(0.45, sky[1]);
      g.addColorStop(0.8, sky[2]);
      g.addColorStop(1, sky[3]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, groundY);

      // Stars — more & brighter as the night deepens.
      const starCount = 14 + stage * 6;
      for (let i = 0; i < starCount; i++) {
        const sx = Math.floor(rand(i) * W);
        const sy = Math.floor(rand(i + 99) * (groundY - 24));
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.5 + i));
        ctx.globalAlpha = (0.25 + 0.55 * tw) * Math.min(1, 0.4 + stage * 0.18);
        px(ctx, sx, sy, 1, 1, P.star);
      }
      ctx.globalAlpha = 1;

      // Ground.
      px(ctx, 0, groundY, W, H - groundY, P.ground);
      px(ctx, 0, groundY, W, 2, P.stone);
      px(ctx, 0, H - 6, W, 6, P.groundDark);
      for (let i = 0; i < 40; i++) {
        px(ctx, Math.floor(rand(i + 7) * W), groundY + 4 + Math.floor(rand(i + 21) * 18), 1, 1, P.groundDark);
      }

      // House on the right (wood + ruby roof, window glows at night).
      const hx = W - 52;
      const hy = groundY - 22;
      px(ctx, hx, hy, 30, 22, P.wood);
      px(ctx, hx, hy, 30, 3, P.woodDark);
      // roof
      for (let r = 0; r < 9; r++) px(ctx, hx - 4 + r, hy - r, 38 - 2 * r, 1, P.ruby);
      px(ctx, hx + 11, hy + 9, 8, 13, P.woodDark); // door
      const winLit = stage >= 1 ? P.flameHot : P.inkSoft;
      px(ctx, hx + 4, hy + 7, 4, 4, winLit);
      px(ctx, hx + 22, hy + 7, 4, 4, winLit);

      // Babel tower — central stacked stone blocks, grows with bet count.
      const levels = Math.min(12, Math.floor(s.betCount / 2));
      const cx = Math.round(W * 0.4);
      // altar / base
      px(ctx, cx - 18, groundY - 6, 36, 6, P.stoneDark);
      px(ctx, cx - 14, groundY - 10, 28, 4, P.stone);
      for (let l = 0; l < levels; l++) {
        const lw = Math.max(8, 24 - l * 1.4);
        const ly = groundY - 10 - (l + 1) * 7;
        px(ctx, cx - lw / 2, ly, lw, 7, l % 2 ? P.stone : P.stoneDark);
        px(ctx, cx - lw / 2, ly, lw, 1, P.goldDark); // mortar line
        // gold trim every 3rd level
        if (l % 3 === 2) px(ctx, cx - lw / 2, ly + 2, lw, 2, P.gold);
      }
      // crowning gold cap once tall enough
      if (levels >= 4) {
        const capY = groundY - 10 - (levels + 1) * 7;
        px(ctx, cx - 4, capY - 4, 8, 5, P.gold);
        px(ctx, cx - 1, capY - 8, 2, 4, P.flameHot);
      }

      // Bonfire at the tower base (animated flame) — only while the round is live.
      if (s.active) {
        const fx = cx;
        const fy = groundY - 4;
        px(ctx, fx - 5, fy, 10, 4, P.woodDark);
        const flick = Math.sin(t * 9) * 1.5 + Math.sin(t * 17 + 1) * 1;
        px(ctx, fx - 3, fy - 6 + flick * 0.2, 6, 6, P.flameCool);
        px(ctx, fx - 2, fy - 9 + flick * 0.4, 4, 6, P.flame);
        px(ctx, fx - 1, fy - 11 + flick * 0.6, 2, 4, P.flameHot);
      }

      // Ambient particles — fireflies (low tiers) → embers/ash (high tiers).
      const pc = 10 + stage * 6;
      for (let i = 0; i < pc; i++) {
        const speed = 8 + rand(i + 3) * 14 + stage * 4;
        const baseX = rand(i + 41) * W;
        const drift = Math.sin(t * 0.6 + i) * 6;
        const yy = groundY - ((t * speed + rand(i + 5) * H) % (groundY - 6));
        const xx = (baseX + drift + W) % W;
        const col = stage <= 1 ? P.gold : stage <= 3 ? P.flame : P.smoke;
        ctx.globalAlpha = 0.5 + 0.4 * Math.abs(Math.sin(t * 2 + i));
        px(ctx, xx, yy, 1, 1, col);
      }
      ctx.globalAlpha = 1;

      // Last-bettor label (pixel mono text, bottom-left).
      ctx.fillStyle = P.inkSoft;
      ctx.font = "8px ui-monospace, Menlo, Consolas, monospace";
      ctx.textBaseline = "bottom";
      ctx.textAlign = "left";
      ctx.fillText(`LAST ${shortAddr(s.lastBettor)}`, 6, H - 6);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Gold Babel pixel arena"
      className={className}
      style={{
        imageRendering: "pixelated",
        width: "100%",
        height: "100%",
        display: "block",
      }}
    />
  );
}
