"use client";

// Gold Babel pixel arena — an animated pixel-art scene for the LMS game,
// reimplemented from the pumpkinswap LMS arena (same palette + stage skies).
// The Babel tower grows with the round's bet count and the sky darkens with
// the tier (DAWN → … → INFERNO). Responsive: the internal pixel grid tracks
// the container's aspect (no distortion) and scales up with
// `image-rendering: pixelated`.
import { useEffect, useRef } from "react";

// Element scale — drawn 30% smaller than full size per design.
const S = 0.7;

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

// Stage names shown in the arena's tier badge (index === stage).
export const ARENA_STAGE_NAMES = [
  "DAWN",
  "DUSK",
  "NIGHT",
  "DEEP NIGHT",
  "WITCHING",
  "INFERNO",
];

// Per-tier sky gradients (top → horizon), from the LMS stage table.
const SKY_STAGES = [
  ["#1A2540", "#3E4B73", "#6B5D7F", "#C98E7E"], // DAWN
  ["#0F1A2E", "#2A2F55", "#513361", "#8C3A4C"], // DUSK
  ["#060913", "#0F1530", "#241A3E", "#3B1F3F"], // NIGHT
  ["#02030A", "#07101E", "#15122D", "#3B1C2F"], // DEEP NIGHT
  ["#010107", "#050815", "#1A0D2E", "#4A1C2A"], // WITCHING
  ["#1A0404", "#2E0510", "#5A0E1E", "#8A1A2A"], // INFERNO
];

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
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
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
  const stateRef = useRef<ArenaState>({ tier, betCount, lastBettor, active });
  useEffect(() => {
    stateRef.current = { tier, betCount, lastBettor, active };
  }, [tier, betCount, lastBettor, active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const parent = canvas.parentElement;
    let raf = 0;
    const start = performance.now();

    // Internal pixel grid follows the container aspect (no stretching).
    const resize = () => {
      const cw = parent?.clientWidth || 240;
      const ch = parent?.clientHeight || 150;
      const scale = Math.max(3, Math.max(cw, ch) / 180); // ~chunky pixels
      canvas.width = Math.max(48, Math.round(cw / scale));
      canvas.height = Math.max(48, Math.round(ch / scale));
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (parent) ro.observe(parent);

    const draw = (now: number) => {
      const W = canvas.width;
      const H = canvas.height;
      const t = (now - start) / 1000;
      const s = stateRef.current;
      const stage = Math.max(0, Math.min(5, s.tier));
      const sky = SKY_STAGES[stage];
      // Thin ground strip (6% of height) — sky and tower dominate the frame.
      const groundY = Math.round(H * 0.94);
      const u = Math.max(2, Math.round(Math.min(W, H) * 0.085 * S)); // base block unit

      // Sky.
      const g = ctx.createLinearGradient(0, 0, 0, groundY);
      g.addColorStop(0, sky[0]);
      g.addColorStop(0.45, sky[1]);
      g.addColorStop(0.8, sky[2]);
      g.addColorStop(1, sky[3]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, groundY);

      // Stars.
      const starCount = Math.round(((W * groundY) / 900) * (0.6 + stage * 0.25));
      for (let i = 0; i < starCount; i++) {
        const sx = Math.floor(rand(i) * W);
        const sy = Math.floor(rand(i + 99) * (groundY - 4));
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.5 + i));
        ctx.globalAlpha = (0.25 + 0.55 * tw) * Math.min(1, 0.45 + stage * 0.16);
        px(ctx, sx, sy, 1, 1, P.star);
      }
      ctx.globalAlpha = 1;

      // Ground.
      px(ctx, 0, groundY, W, H - groundY, P.ground);
      px(ctx, 0, groundY, W, Math.max(1, u * 0.2), P.stone);
      px(ctx, 0, H - Math.max(1, u * 0.6), W, u, P.groundDark);
      for (let i = 0; i < Math.round(W / 6); i++) {
        px(ctx, Math.floor(rand(i + 7) * W), groundY + 2 + Math.floor(rand(i + 21) * (H - groundY - 2)), 1, 1, P.groundDark);
      }

      // House (right): wood walls + ruby roof, window glows at night.
      // Drawn 40% smaller than the original (dims ×0.6) so the tower leads.
      const hw = u * 3;
      const hh = u * 2.4;
      const hx = W - hw - u * 2;
      const hy = groundY - hh;
      px(ctx, hx, hy, hw, hh, P.wood);
      px(ctx, hx, hy, hw, Math.max(1, u * 0.3), P.woodDark);
      const roofH = Math.max(2, Math.round(u * 0.96));
      for (let r = 0; r < roofH; r++) {
        const inset = (r / roofH) * (hw / 2 + u * 0.6);
        px(ctx, hx - u * 0.6 + inset, hy - r, hw + 2 * u * 0.6 - 2 * inset, 1, P.ruby);
      }
      px(ctx, hx + hw / 2 - u * 0.45, hy + hh - u * 1.2, u * 0.9, u * 1.2, P.woodDark); // door
      const winLit = stage >= 1 ? P.flameHot : P.inkSoft;
      px(ctx, hx + u * 0.5, hy + u * 0.7, u * 0.6, u * 0.6, winLit);
      px(ctx, hx + hw - u * 1.1, hy + u * 0.7, u * 0.6, u * 0.6, winLit);

      // Babel tower (center) — stacked stone, grows 1 level per 2 bets.
      // Capped by what fits the canvas, so a taller container (the card
      // stretches with bet count) lets the tower keep climbing. The 5.5u
      // headroom keeps the capstone + flame (1.6u) visible even at max fill;
      // the gentle 0.18u taper keeps upper levels from thinning out.
      const lh = Math.max(2, u * 1.1);
      const maxFit = Math.max(4, Math.floor((groundY - u * 5.5) / lh));
      const levels = Math.min(maxFit, Math.floor(s.betCount / 2));
      const cx = Math.round(W * 0.4);
      px(ctx, cx - u * 3, groundY - u, u * 6, u, P.stoneDark); // base
      px(ctx, cx - u * 2.3, groundY - u * 1.7, u * 4.6, u * 0.8, P.stone);
      for (let l = 0; l < levels; l++) {
        const lw = Math.max(u * 1.3, u * 4 - l * u * 0.18);
        const ly = groundY - u * 1.7 - (l + 1) * lh;
        px(ctx, cx - lw / 2, ly, lw, lh, l % 2 ? P.stone : P.stoneDark);
        px(ctx, cx - lw / 2, ly, lw, 1, P.goldDark);
        if (l % 3 === 2) px(ctx, cx - lw / 2, ly + lh * 0.4, lw, Math.max(1, lh * 0.3), P.gold);
      }
      if (levels >= 4) {
        const capY = groundY - u * 1.7 - (levels + 1) * lh;
        px(ctx, cx - u * 0.7, capY - u * 0.7, u * 1.4, u * 0.9, P.gold);
        px(ctx, cx - u * 0.2, capY - u * 1.6, u * 0.4, u * 0.9, P.flameHot);
      }

      // Bonfire at the base (flickers while the round is live).
      if (s.active) {
        const fx = cx;
        const fy = groundY - u * 0.5;
        px(ctx, fx - u, fy, u * 2, u * 0.7, P.woodDark);
        const flick = Math.sin(t * 9) + Math.sin(t * 17 + 1) * 0.6;
        px(ctx, fx - u * 0.6, fy - u + flick * 0.1, u * 1.2, u * 1.1, P.flameCool);
        px(ctx, fx - u * 0.4, fy - u * 1.6 + flick * 0.2, u * 0.8, u * 1.1, P.flame);
        px(ctx, fx - u * 0.2, fy - u * 2 + flick * 0.3, u * 0.4, u * 0.7, P.flameHot);
      }

      // Ambient particles — fireflies (low) → embers/ash (high).
      const pc = 8 + stage * 5;
      for (let i = 0; i < pc; i++) {
        const speed = 8 + rand(i + 3) * 14 + stage * 4;
        const baseX = rand(i + 41) * W;
        const drift = Math.sin(t * 0.6 + i) * (W * 0.03);
        const yy = groundY - ((t * speed + rand(i + 5) * H) % (groundY - 2));
        const xx = (baseX + drift + W) % W;
        const col = stage <= 1 ? P.gold : stage <= 3 ? P.flame : P.smoke;
        ctx.globalAlpha = 0.5 + 0.4 * Math.abs(Math.sin(t * 2 + i));
        px(ctx, xx, yy, 1, 1, col);
      }
      ctx.globalAlpha = 1;

      if (running) raf = requestAnimationFrame(draw);
    };

    // Pause the loop when the canvas can't be seen (offscreen / hidden tab)
    // or the user prefers reduced motion — saves battery on mobile. A single
    // frame is always drawn so the paused canvas isn't blank.
    let running = false;
    let visible = true;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const setRunning = () => {
      const next = visible && !document.hidden && !reducedMotion;
      if (next === running) return;
      running = next;
      cancelAnimationFrame(raf);
      if (running) raf = requestAnimationFrame(draw);
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      setRunning();
    });
    io.observe(canvas);
    const onVisibility = () => setRunning();
    document.addEventListener("visibilitychange", onVisibility);

    draw(performance.now()); // static first frame (reduced-motion keeps it)
    setRunning();
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
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
