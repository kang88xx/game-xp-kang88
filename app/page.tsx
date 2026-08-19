"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Trophy, Clock, Flame, Users, TrendingUp, Loader2, Dices } from "lucide-react";
import { useMetaMask } from "@/lib/use-metamask";
import { erc20Abi, formatUnits, maxUint256, parseUnits } from "viem";
import { usePublicClient, useReadContract } from "wagmi";
import { useActiveAccount, useSendContractTx } from "@/lib/active-account";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDexStore, useHydrated, LMS_CONFIG } from "@/lib/store";
import { useBalance } from "@/lib/balances";
import { formatNumber, shortAddress, timeAgoPure } from "@/lib/format";
import { ArrowChip } from "@/components/ui";
import { AddToWalletButton } from "@/components/AddToWalletButton";
import { PixelArena, ARENA_STAGE_NAMES } from "@/components/PixelArena";
import { TierTable } from "@/components/TierTable";
import { PerspectiveGrid } from "@/components/PerspectiveGrid";
import { toast } from "@/components/toast";
import { TOKEN_MAP } from "@/lib/tokens";
import { CHAIN_ID, EXPLORER_URL } from "@/lib/chain";
import { LMS_ABI, LMS_CONTRACT, lmsLive } from "@/lib/lms";

// Game fee destinations (display only until on-chain payouts ship).
const FEE_WALLETS = {
  treasury: "0x8d75BD466f1c1998408F81fddC75B9C61Cb2Ab7A",
  burn: "0x3cDab84c91C8974b6A4FdC9bb7CB8fF22f2a6B81",
};
const EXPLORER = EXPLORER_URL;

// Meme-coin bet sizes (KANGTEST1 trades for fractions of a cent).
const QUICK_CHIPS = [100, 500, 1000, 5000];

function mmss(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function hhmmss(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const LMS_INTRO_KEY = "lms-intro-dismissed";

/**
 * Count-up animation for stat numbers: eases from the previous value (0 on
 * first load) to `target` over ~1.8s. Honors prefers-reduced-motion by
 * jumping straight to the target.
 */
function useCountUp(target: number, duration = 1800): number {
  const [display, setDisplay] = useState(0);
  const prevTarget = useRef<number | null>(null);

  useEffect(() => {
    if (prevTarget.current === target) return;
    const from = prevTarget.current ?? 0;
    prevTarget.current = target;
    let raf = 0;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced || from === target) {
      raf = requestAnimationFrame(() => setDisplay(target));
      return () => cancelAnimationFrame(raf);
    }
    const start = performance.now();
    // Whole-number targets count in whole steps — fractional cents flickering
    // through the animation read as noise, not motion.
    const wholeSteps = Number.isInteger(from) && Number.isInteger(target);
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      const value = from + (target - from) * eased;
      setDisplay(p >= 1 ? target : wholeSteps ? Math.round(value) : value);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return display;
}

export default function GamesPage() {
  // lmsLive is a build-time env constant — same on server and client.
  const hydrated = useHydrated();
  const [dismissed, setDismissed] = useState(false);
  // Read the persisted "do not show again" flag once, SSR-safe.
  const [persisted] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(LMS_INTRO_KEY) === "1";
    } catch {
      return false;
    }
  });
  // Gate on `hydrated` so the modal only appears after hydration (no SSR
  // mismatch) and we never call setState inside an effect.
  const showIntro = hydrated && !persisted && !dismissed;
  return (
    <>
      {showIntro && <LmsIntroModal onClose={() => setDismissed(true)} />}
      <div className="relative isolate">
        {/* fire gradient for the burn flame icon (stroke="url(#flame-grad)") */}
        <svg aria-hidden width="0" height="0" className="absolute">
          <defs>
            <linearGradient id="flame-grad" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#cf1512" />
              <stop offset="0.55" stopColor="#ff9738" />
              <stop offset="1" stopColor="#ffeed4" />
            </linearGradient>
          </defs>
        </svg>
        <PerspectiveGrid />
        {lmsLive ? <OnchainGame /> : <DemoGame />}
      </div>
    </>
  );
}

// ─── Intro modal — "Last Man Standing" rules, shown on entering /games ───────
function LmsIntroModal({ onClose }: { onClose: () => void }) {
  const [dontShow, setDontShow] = useState(false);
  const close = () => {
    if (dontShow) {
      try {
        localStorage.setItem(LMS_INTRO_KEY, "1");
      } catch {
        /* ignore */
      }
    }
    onClose();
  };

  // Dialog behavior: Escape closes, body scroll locks while open.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/50 p-4 pt-28 sm:pt-36">
      <div className="absolute inset-0" onClick={close} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Last Man Standing"
        className="animate-fade-in burnband relative max-h-[calc(100dvh-5rem)] w-full max-w-md overflow-y-auto rounded-3xl shadow-2xl"
        style={{ backgroundColor: "var(--card)" }}
      >
        <span aria-hidden className="beam-ring" />
        <div className="px-6 pt-7 pb-1 text-center">
          <h2 className="burn-digits text-2xl font-bold tracking-tight">
            Last Man Standing
          </h2>
          <p className="mx-auto mt-2 max-w-[320px] text-[13px] font-light leading-relaxed text-[var(--muted)]">
            A betting round where the final eligible bettor before expiry
            receives the credited prize.
          </p>
        </div>

        <div className="flex flex-col gap-2 px-5 pt-4">
          <LmsStep
            icon={<Dices className="h-4 w-4" />}
            title="Enter with the current minimum"
            body="The page submits only the active on-chain minimum bet."
          />
          <LmsStep
            icon={<Clock className="h-4 w-4" />}
            title="Take the lead"
            body="Your bet resets the timer and makes you the last bettor."
          />
          <LmsStep
            icon={<Trophy className="h-4 w-4" />}
            title="Claim after settlement"
            body="Winnings and refunds are credited first, then withdrawn with claim."
          />
        </div>

        <div className="mx-5 mt-3 rounded-xl border border-dashed border-[rgba(255,151,56,0.25)] bg-[rgba(255,151,56,0.04)] px-3 py-2 text-center font-mono text-xs text-[var(--muted)]">
          <b className="font-semibold text-[var(--accent-bright)]">80%</b> prize
          {" · "}
          <b className="font-semibold text-[var(--accent-bright)]">15%</b> treasury
          {" · "}
          <b className="font-semibold text-[var(--accent-bright)]">5%</b> burn
        </div>

        <div className="px-5 pb-6 pt-4">
          <button
            onClick={close}
            className="group flex w-full items-center justify-center gap-2.5 rounded-full bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[var(--accent-hover)] active:scale-[0.985]"
          >
            Enter Game
            <ArrowChip />
          </button>
          <label className="mt-3 flex cursor-pointer select-none items-center justify-center gap-2 text-xs text-[var(--muted)]">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--accent)]"
            />
            Do not show again
          </label>
        </div>
      </div>
    </div>
  );
}

function LmsStep({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-full border border-[var(--border)] bg-white/[0.02] py-2.5 pl-2.5 pr-5">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
        style={{ background: "var(--grad-btn)" }}
      >
        {icon}
      </span>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-0.5 text-xs font-light leading-snug text-[var(--muted)]">
          {body}
        </div>
      </div>
    </div>
  );
}

/** The local demo (phantom bots, store rounds) — shown until KangLMS is deployed. */
function DemoGame() {
  const hydrated = useHydrated();
  const connected = useDexStore((s) => s.connected);
  const address = useDexStore((s) => s.address);
  const { open: openWalletModal } = useMetaMask();
  const round = useDexStore((s) => s.lms.round);
  const history = useDexStore((s) => s.lms.history);
  const pendingClaims = useDexStore((s) => s.lms.pendingClaims);
  const lmsEnsureRound = useDexStore((s) => s.lmsEnsureRound);
  const lmsCheckExpiry = useDexStore((s) => s.lmsCheckExpiry);
  const lmsBotTick = useDexStore((s) => s.lmsBotTick);
  const kang = useBalance("KANGTEST1");
  // Count-up on page load for the two headline stats.
  const animPrizePool = useCountUp(round.prizePool);
  const animBurned = useCountUp(round.burnedPool);

  const [amount, setAmount] = useState("100");
  // nowMs drives both the countdown display and timeAgoPure calls — pure render
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [srAnnounce, setSrAnnounce] = useState<{ id: number; message: string } | null>(null);

  const botTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const announcedExpiryRef = useRef(false);
  const prevClaimCountRef = useRef(0);
  const prevRoundIdRef = useRef<string | null>(null);
  const prevRemainingRef = useRef<number>(Infinity);

  // On mount: ensure a round exists, handle stale persisted rounds
  useEffect(() => {
    lmsEnsureRound();
  }, [lmsEnsureRound]);

  // 1-second ticker — updates nowMs, which drives remainingMs and timeAgoPure in render
  useEffect(() => {
    countdownRef.current = setInterval(() => {
      lmsCheckExpiry();
      setNowMs(Date.now());
    }, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [lmsCheckExpiry]);

  // Bot tick every ~10s
  useEffect(() => {
    botTickRef.current = setInterval(() => {
      lmsBotTick();
    }, LMS_CONFIG.BOT_TICK_MS);
    return () => {
      if (botTickRef.current) clearInterval(botTickRef.current);
    };
  }, [lmsBotTick]);

  const parsedAmt = parseFloat(amount);
  const betAmt = Number.isFinite(parsedAmt) ? parsedAmt : 0;
  const isActive = round.status === "active";
  const overBalance = hydrated && connected && betAmt > kang;

  // Pure derivations — no Date.now() in render
  const remainingMs = Math.max(0, round.endsAt - nowMs);

  // Memoized unique player count keyed on bets array reference
  const uniquePlayers = useMemo(
    () => new Set(round.bets.map((b) => b.address)).size,
    [round.bets],
  );

  const previewPrize =
    betAmt > 0 ? round.prizePool + betAmt * LMS_CONFIG.FEE_PRIZE : 0;

  // Pending claims for this address
  const myClaims = useMemo(
    () =>
      address
        ? (pendingClaims ?? []).filter((c) => c.address === address)
        : [],
    [pendingClaims, address],
  );

  // Sparse screen-reader announcements — fires as side-effects of state changes
  useEffect(() => {
    // Reset expiry announcement flag and prevRemainingRef when round changes
    if (prevRoundIdRef.current !== round.id) {
      prevRoundIdRef.current = round.id;
      announcedExpiryRef.current = false;
      prevRemainingRef.current = Infinity;
      setSrAnnounce({ id: Date.now(), message: "New round started" });
    }
  }, [round.id]);

  useEffect(() => {
    if (
      prevRemainingRef.current >= 10_000 &&
      remainingMs < 10_000 &&
      remainingMs > 0 &&
      !announcedExpiryRef.current
    ) {
      setSrAnnounce({ id: Date.now(), message: "Round about to expire" });
      announcedExpiryRef.current = true;
    }
    prevRemainingRef.current = remainingMs;
  }, [remainingMs]);

  useEffect(() => {
    const currentCount = myClaims.length;
    if (currentCount > prevClaimCountRef.current) {
      setSrAnnounce({ id: Date.now(), message: "You won the round. Claim available." });
    }
    prevClaimCountRef.current = currentCount;
  }, [myClaims.length]);

  const maxBet = () =>
    setAmount(kang > 0 ? String(Math.floor(kang)) : "0");

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Title row */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="grad-text text-2xl font-bold tracking-tight">
                Last Man Standing
              </h1>
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs text-[var(--muted)]">
                Demo rounds · on-chain soon
              </span>
            </div>
            <p className="text-sm text-[var(--muted)]">
              Place a bet. Reset the timer. Last bettor wins the pool.
            </p>
          </div>
        </div>

      </div>

      {/* Hero countdown card */}
      <div className="burnband rounded-3xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-7 shadow-2xl mb-5 flex flex-col items-center text-center">
            <span aria-hidden className="ember" style={{ left: "2.0%", bottom: 0, width: 3, height: 3, background: "var(--dot-yellow)", animationDelay: "0.0s", animationDuration: "1.2s" }} />
            <span aria-hidden className="ember" style={{ left: "5.7%", bottom: 5, animationDelay: "0.37s", animationDuration: "1.31s" }} />
            <span aria-hidden className="ember" style={{ left: "9.4%", bottom: 10, width: 3, height: 3, background: "var(--accent)", animationDelay: "0.74s", animationDuration: "1.42s" }} />
            <span aria-hidden className="ember" style={{ left: "13.1%", bottom: 0, background: "var(--dot-yellow)", animationDelay: "1.11s", animationDuration: "1.53s" }} />
            <span aria-hidden className="ember" style={{ left: "16.8%", bottom: 5, width: 3, height: 3, animationDelay: "1.48s", animationDuration: "1.64s" }} />
            <span aria-hidden className="ember" style={{ left: "20.5%", bottom: 10, background: "var(--accent)", animationDelay: "1.85s", animationDuration: "1.75s" }} />
            <span aria-hidden className="ember" style={{ left: "24.2%", bottom: 0, width: 3, height: 3, background: "var(--dot-yellow)", animationDelay: "2.22s", animationDuration: "1.2s" }} />
            <span aria-hidden className="ember" style={{ left: "27.8%", bottom: 5, animationDelay: "0.19s", animationDuration: "1.31s" }} />
            <span aria-hidden className="ember" style={{ left: "31.5%", bottom: 10, width: 3, height: 3, background: "var(--accent)", animationDelay: "0.56s", animationDuration: "1.42s" }} />
            <span aria-hidden className="ember" style={{ left: "35.2%", bottom: 0, background: "var(--dot-yellow)", animationDelay: "0.93s", animationDuration: "1.53s" }} />
            <span aria-hidden className="ember" style={{ left: "38.9%", bottom: 5, width: 3, height: 3, animationDelay: "1.3s", animationDuration: "1.64s" }} />
            <span aria-hidden className="ember" style={{ left: "42.6%", bottom: 10, background: "var(--accent)", animationDelay: "1.67s", animationDuration: "1.75s" }} />
            <span aria-hidden className="ember" style={{ left: "46.3%", bottom: 0, width: 3, height: 3, background: "var(--dot-yellow)", animationDelay: "2.04s", animationDuration: "1.2s" }} />
            <span aria-hidden className="ember" style={{ left: "50.0%", bottom: 5, animationDelay: "0.01s", animationDuration: "1.31s" }} />
            <span aria-hidden className="ember" style={{ left: "53.7%", bottom: 10, width: 3, height: 3, background: "var(--accent)", animationDelay: "0.38s", animationDuration: "1.42s" }} />
            <span aria-hidden className="ember" style={{ left: "57.4%", bottom: 0, background: "var(--dot-yellow)", animationDelay: "0.75s", animationDuration: "1.53s" }} />
            <span aria-hidden className="ember" style={{ left: "61.1%", bottom: 5, width: 3, height: 3, animationDelay: "1.12s", animationDuration: "1.64s" }} />
            <span aria-hidden className="ember" style={{ left: "64.8%", bottom: 10, background: "var(--accent)", animationDelay: "1.49s", animationDuration: "1.75s" }} />
            <span aria-hidden className="ember" style={{ left: "68.5%", bottom: 0, width: 3, height: 3, background: "var(--dot-yellow)", animationDelay: "1.86s", animationDuration: "1.2s" }} />
            <span aria-hidden className="ember" style={{ left: "72.2%", bottom: 5, animationDelay: "2.23s", animationDuration: "1.31s" }} />
            <span aria-hidden className="ember" style={{ left: "75.8%", bottom: 10, width: 3, height: 3, background: "var(--accent)", animationDelay: "0.2s", animationDuration: "1.42s" }} />
            <span aria-hidden className="ember" style={{ left: "79.5%", bottom: 0, background: "var(--dot-yellow)", animationDelay: "0.57s", animationDuration: "1.53s" }} />
            <span aria-hidden className="ember" style={{ left: "83.2%", bottom: 5, width: 3, height: 3, animationDelay: "0.94s", animationDuration: "1.64s" }} />
            <span aria-hidden className="ember" style={{ left: "86.9%", bottom: 10, background: "var(--accent)", animationDelay: "1.31s", animationDuration: "1.75s" }} />
            <span aria-hidden className="ember" style={{ left: "90.6%", bottom: 0, width: 3, height: 3, background: "var(--dot-yellow)", animationDelay: "1.68s", animationDuration: "1.2s" }} />
            <span aria-hidden className="ember" style={{ left: "94.3%", bottom: 5, animationDelay: "2.05s", animationDuration: "1.31s" }} />
            <span aria-hidden className="ember" style={{ left: "98.0%", bottom: 10, width: 3, height: 3, background: "var(--accent)", animationDelay: "0.02s", animationDuration: "1.42s" }} />
        <span className="text-xs font-medium text-[var(--muted)] mb-3">
          Time Remaining
        </span>

        <div
          className={`font-mono text-7xl sm:text-8xl font-bold tabular-nums leading-none mb-4 transition-transform ${
            remainingMs < 10_000 ? "" : "burn-digits"
          }`}
          style={remainingMs < 10_000 ? { color: "var(--down)" } : undefined}
        >
          {mmss(remainingMs)}
        </div>

        {/* Sparse screen-reader announcer — only fires on meaningful events */}
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {srAnnounce?.message}
        </div>

        {/* Last bettor */}
        <div className="text-sm text-[var(--muted)]">
          {round.lastBettor ? (
            <>
              Last bettor:{" "}
              <span className="font-mono font-medium text-[var(--foreground)]">
                {shortAddress(round.lastBettor)}
                {round.lastBettor === address && (
                  <span className="ml-1.5 inline-flex items-center rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-bold text-[var(--accent)]">
                    YOU
                  </span>
                )}
              </span>
            </>
          ) : (
            <span>No bets yet</span>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="Prize Pool"
          value={formatNumber(animPrizePool, 2)}
          unit="KANGTEST1"
          accent
          valueColor="var(--accent-bright)"
          motion="beam"
        />
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="Players"
          value={String(uniquePlayers)}
          detail="this round"
        />
        <StatCard
          icon={<Clock className="h-5 w-5" />}
          label="Total Bets"
          value={String(round.bets.length)}
          detail="this round"
        />
        <StatCard
          icon={<Flame className="flamebob h-5 w-5" stroke="url(#flame-grad)" fill="url(#flame-grad)" />}
          label="Burned"
          value={formatNumber(animBurned, 2)}
          unit="KANGTEST1"
          valueColor="var(--accent)"
          motion="embers"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_340px]">
        {/* Left column: claims card + bet card + fee bar */}
        <div className="flex flex-col gap-4 max-md:contents">
          {/* Your Claims card — only rendered when there are pending claims */}
          {myClaims.length > 0 && (
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 sm:p-7 shadow-2xl">
              <div className="flex items-center gap-2 mb-4">
                <Trophy className="h-4 w-4 text-[var(--up)]" />
                <h2 className="text-base font-semibold">Your Claims</h2>
              </div>
              <div className="space-y-2">
                {myClaims.map((claim) => (
                  <div
                    key={claim.id}
                    className="flex items-center justify-between rounded-2xl bg-[var(--surface)] px-4 py-3 text-sm"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="font-mono text-xs text-[var(--muted-2)]">
                        Round #{claim.roundId.slice(-4)}
                      </span>
                      <span className="font-semibold">
                        {claim.amount.toFixed(2)} KANGTEST1
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-[var(--muted)]">
                        {timeAgoPure(claim.createdAt, nowMs)}
                      </span>
                      <button
                        disabled
                        title="On-chain payouts coming soon"
                        aria-label={`Claim ${claim.amount.toFixed(2)} KANGTEST1 from round ${claim.roundId.slice(-4)} · on-chain payouts coming soon`}
                        className="cursor-not-allowed rounded-xl bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--muted-2)]"
                      >
                        Claim
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Place Your Bet card */}
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 sm:p-7 shadow-2xl">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="shrink-0 text-base font-semibold">Place Your Bet</h2>
              <AddToWalletButton symbol="KANGTEST1" />
            </div>

            {/* Amount input */}
            <div className="rounded-2xl bg-[var(--surface)] p-4">
              <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                <label htmlFor="lms-bet-amount">Bet amount</label>
                {hydrated && connected && (
                  <span>
                    Balance:{" "}
                    <span
                      className={
                        overBalance ? "font-semibold text-[var(--down)]" : ""
                      }
                    >
                      {formatNumber(kang, 2)} KANGTEST1
                    </span>
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center">
                <input
                  id="lms-bet-amount"
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  min={LMS_CONFIG.MIN_BET}
                  placeholder="0"
                  className="w-full bg-transparent text-2xl font-semibold outline-none placeholder:text-[var(--muted-2)]"
                />
                <span className="text-sm font-semibold text-[var(--muted)]">
                  KANGTEST1
                </span>
              </div>
              <div className="mt-2 flex gap-2 flex-wrap">
                {QUICK_CHIPS.map((v) => (
                  <button
                    key={v}
                    onClick={() => setAmount(String(v))}
                    className="rounded-lg bg-[var(--card)] px-2.5 py-1 text-xs font-medium text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                  >
                    {v}
                  </button>
                ))}
                <button
                  disabled={!hydrated || !connected}
                  onClick={maxBet}
                  className="rounded-lg bg-[var(--card)] px-2.5 py-1 text-xs font-medium text-[var(--muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
                >
                  MAX
                </button>
              </div>
            </div>

            {/* Payout preview */}
            <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] px-4 py-3 text-sm">
              <span className="text-[var(--muted)]">
                Payout if you hold the last bet
                <span className="hidden text-xs text-[var(--muted-2)] lg:inline">
                  {" "}
                  · 80% of every bet feeds the pool
                </span>
              </span>
              <span className="whitespace-nowrap font-medium">
                {betAmt > 0 ? `${formatNumber(previewPrize, 2)} KANGTEST1` : "0 KANGTEST1"}
              </span>
            </div>

            {/* Action button */}
            <div className="mt-5">
              {!hydrated ? (
                <div className="h-12 w-full rounded-2xl bg-[var(--surface-2)] animate-pulse-soft" />
              ) : !connected ? (
                <button
                  onClick={() => openWalletModal()}
                  className="h-12 w-full rounded-full bg-[var(--accent)] font-semibold text-white transition-all hover:bg-[var(--accent-hover)] active:scale-[0.985]"
                >
                  Connect Wallet
                </button>
              ) : (
                <button
                  disabled
                  className="h-12 w-full rounded-full bg-[var(--accent)] font-semibold text-white transition-all hover:bg-[var(--accent-hover)] active:scale-[0.985] disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--muted-2)]"
                >
                  {!isActive
                    ? "Round ended"
                    : overBalance
                      ? "Insufficient KANGTEST1"
                      : betAmt < LMS_CONFIG.MIN_BET
                        ? `Minimum ${LMS_CONFIG.MIN_BET} KANGTEST1`
                        : "On-chain game coming soon"}
                </button>
              )}
            </div>

            <p className="mt-3 text-center text-xs text-[var(--muted-2)]">
              No randomness · last bettor wins the pool · on-chain version
              coming soon
            </p>
          </div>

          {/* Fee distribution bar — reference info, stacks last on mobile */}
          <div className="max-md:order-last rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5">
            <h3 className="text-sm font-semibold mb-3">Fee Distribution</h3>
            <div className="flex h-3 w-full overflow-hidden rounded-full">
              <div
                className="h-full"
                style={{ width: "80%", backgroundColor: "var(--accent-bright)" }}
                title="80% Prize Pool"
              />
              <div
                className="h-full"
                style={{ width: "15%", backgroundColor: "var(--treasury)" }}
                title="15% Treasury"
              />
              <div
                className="h-full"
                style={{ width: "5%", backgroundColor: "var(--burn)" }}
                title="5% Burn"
              />
            </div>
            <div className="mt-3 grid gap-3 text-xs text-[var(--muted)] sm:grid-cols-3">
              <LegendRow
                color="var(--accent-bright)"
                label="Prize"
                pct="80%"
                address={LMS_CONTRACT}
              />
              <LegendRow
                color="var(--treasury)"
                label="Treasury"
                pct="15%"
                address={FEE_WALLETS.treasury}
              />
              <LegendRow
                color="var(--burn)"
                label="Burn"
                pct="5%"
                address={FEE_WALLETS.burn}
              />
            </div>
          </div>
        </div>

        {/* Right column: recent bets + round history */}
        <div className="flex flex-col gap-4 max-md:contents">
          {/* Recent Bets */}
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Recent Bets</h3>
              <span className="text-xs text-[var(--muted-2)]">Latest 12</span>
            </div>
            {round.bets.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[var(--border)] px-3 py-6 text-center text-xs text-[var(--muted-2)]">
                No bets yet · be the first.
              </p>
            ) : (
              <div className="space-y-1.5">
                {/* Header */}
                <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 px-2 pb-1 text-xs text-[var(--muted-2)]">
                  <span>Time</span>
                  <span>Address</span>
                  <span>Amount</span>
                  <span>Rd</span>
                </div>
                {round.bets.slice(0, 12).map((bet) => (
                  <div
                    key={bet.id}
                    className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center rounded-xl px-2 py-1.5 text-xs transition-colors"
                  >
                    <span className="text-[var(--muted)]">
                      {timeAgoPure(bet.timestamp, nowMs)}
                    </span>
                    <span className="font-mono">
                      {shortAddress(bet.address)}
                      {bet.address === address && (
                        <span className="ml-1 inline-flex items-center rounded-full bg-[var(--accent-soft)] px-1.5 py-px text-[9px] font-bold text-[var(--accent)]">
                          YOU
                        </span>
                      )}
                    </span>
                    <span className="font-medium text-right">
                      {formatNumber(bet.amount, 2)}
                    </span>
                    <span className="text-[var(--muted-2)] text-right font-mono text-xs">
                      #{round.id.slice(-4)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Round History */}
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5">
            <h3 className="text-sm font-semibold mb-3">Round History</h3>
            {history.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[var(--border)] px-3 py-6 text-center text-xs text-[var(--muted-2)]">
                First round in progress.
              </p>
            ) : (
              <div className="space-y-1.5">
                <div className="grid grid-cols-[auto_1fr_auto_auto] gap-2 px-2 pb-1 text-xs text-[var(--muted-2)]">
                  <span>Round</span>
                  <span>Winner</span>
                  <span>Prize</span>
                  <span>Ended</span>
                </div>
                {history.slice(0, 5).map((h) => (
                  <div
                    key={h.roundId}
                    className="grid grid-cols-[auto_1fr_auto_auto] gap-2 items-center rounded-xl px-2 py-1.5 text-xs"
                  >
                    <span className="font-mono text-[var(--muted-2)] text-xs">
                      #{h.roundId.slice(-4)}
                    </span>
                    <span className="font-mono truncate flex items-center gap-1">
                      {h.winner ? shortAddress(h.winner) : "Refund"}
                      {h.isBot && (
                        <span className="inline-flex items-center rounded-full bg-[var(--surface-2)] px-1.5 py-px text-[9px] font-bold text-[var(--muted)]">
                          BOT
                        </span>
                      )}
                    </span>
                    <span className="font-medium text-right">
                      {formatNumber(h.prize, 2)}
                    </span>
                    <span className="text-[var(--muted)] text-right">
                      {timeAgoPure(h.endedAt, nowMs)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── On-chain game (KangLMS) ──────────────────────────────────────────────────

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

// Event queries scan from the contract's deploy block when configured —
// Xphere mints ~1 block/second (40M+ blocks), so an "earliest" scan is a
// full-chain getLogs on every poll. Set NEXT_PUBLIC_LMS_DEPLOY_BLOCK at
// deploy time (deploy-lms.mjs prints it); the fallback is the current
// mainnet KangLMS deploy block so a missing env var degrades gracefully
// instead of hitting RPC log-range limits and rendering an empty game.
const LMS_FROM_BLOCK: bigint = process.env.NEXT_PUBLIC_LMS_DEPLOY_BLOCK
  ? BigInt(process.env.NEXT_PUBLIC_LMS_DEPLOY_BLOCK)
  : 32238780n;

/**
 * The real game — round state, bets, prizes all live on the KangLMS contract.
 * Anyone can settle an expired round (pull-payment prizes, no keeper needed).
 */
function OnchainGame() {
  const hydrated = useHydrated();
  const connected = useDexStore((s) => s.connected);
  const { open: openWalletModal } = useMetaMask();
  // wagmi 확장/인앱 + ZIGAP 딥링크 세션을 하나의 계정으로 취급한다.
  const { address: wallet, onXphere } = useActiveAccount();
  const sendTx = useSendContractTx();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const kang = useBalance("KANGTEST1");

  const [nowMs, setNowMs] = useState(() => Date.now());
  // "bet" | "claim-all" | `claim:${roundId}` | null
  const [busy, setBusy] = useState<string | null>(null);

  const contract = LMS_CONTRACT as `0x${string}`;
  const dec = TOKEN_MAP.KANGTEST1?.decimals ?? 18;
  const kangAddr = TOKEN_MAP.KANGTEST1?.address as `0x${string}` | undefined;

  // Live round (id, prizePool, totalBurned, deadline, lastBettor, betCount,
  // uniquePlayers, settled) — one read, 5s refresh.
  const { data: roundData } = useReadContract({
    address: contract,
    abi: LMS_ABI,
    functionName: "currentRound",
    chainId: CHAIN_ID,
    query: { refetchInterval: 5_000 },
  });
  const { data: pendingWei } = useReadContract({
    address: contract,
    abi: LMS_ABI,
    functionName: "pendingPrize",
    args: wallet ? [wallet] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!wallet, refetchInterval: 10_000 },
  });
  // Per-round win records — each is claimable on its own (claimRound).
  const { data: winsData } = useReadContract({
    address: contract,
    abi: LMS_ABI,
    functionName: "winsOf",
    args: wallet ? [wallet] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!wallet, refetchInterval: 10_000 },
  });
  const { data: minBetWei, refetch: refetchMinBet } = useReadContract({
    address: contract,
    abi: LMS_ABI,
    functionName: "currentMinBet",
    chainId: CHAIN_ID,
    query: { refetchInterval: 30_000 },
  });
  const { data: tierRaw } = useReadContract({
    address: contract,
    abi: LMS_ABI,
    functionName: "currentTier",
    chainId: CHAIN_ID,
    query: { refetchInterval: 30_000 },
  });
  const { data: isPaused } = useReadContract({
    address: contract,
    abi: LMS_ABI,
    functionName: "paused",
    chainId: CHAIN_ID,
    query: { refetchInterval: 30_000 },
  });
  // The tier's full round timer — shown while the board waits for the first
  // bet. Read on-chain (owner can retune baseDuration/minDuration) instead
  // of assuming the 24h default.
  const { data: tierDurationSec } = useReadContract({
    address: contract,
    abi: LMS_ABI,
    functionName: "durationForTier",
    args: [tierRaw ?? 0],
    chainId: CHAIN_ID,
    query: { refetchInterval: 60_000 },
  });

  // 1-second ticker drives the countdown.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const round = roundData
    ? {
        id: Number(roundData[0]),
        prizePoolWei: roundData[1],
        burnedWei: roundData[2],
        deadlineMs: Number(roundData[3]) * 1000,
        lastBettor: roundData[4] as string,
        betCount: Number(roundData[5]),
        uniquePlayers: Number(roundData[6]),
        settled: roundData[7],
      }
    : null;

  const prizePool = round ? Number(formatUnits(round.prizePoolWei, dec)) : 0;
  const burned = round ? Number(formatUnits(round.burnedWei, dec)) : 0;
  const minBet = minBetWei != null ? Number(formatUnits(minBetWei, dec)) : 0;
  const tier = tierRaw != null ? Number(tierRaw) : 0;
  const pending = pendingWei != null ? Number(formatUnits(pendingWei, dec)) : 0;

  // deadline == 0 → the round is waiting for its first bet (lazy start).
  const waiting = round != null && round.deadlineMs === 0;
  const remainingMs =
    round && !waiting ? Math.max(0, round.deadlineMs - nowMs) : 0;
  const expired =
    round != null && !waiting && remainingMs <= 0 && !round.settled;
  const lastBettor =
    round && round.lastBettor !== ZERO_ADDR ? round.lastBettor : null;
  // A just-ended pot isn't credited until settlement, but claim() settles
  // automatically on-chain — so show it to the winner as claimable right away.
  const unsettledWin =
    expired &&
    wallet &&
    lastBettor &&
    lastBettor.toLowerCase() === wallet.toLowerCase()
      ? prizePool
      : 0;
  const claimable = pending + unsettledWin;

  // The just-won pot isn't settled on-chain yet, so it has no win record —
  // surface it as a synthetic row (claimRound settles it first, then pays).
  const justWonRoundId = unsettledWin > 0 && round ? round.id : null;

  // Per-round prize rows: synthetic just-won pot + each unclaimed win record.
  // Newest round first. Small list — recomputed each render (no memo needed).
  const prizeRows: { roundId: number; amount: number; isRefund: boolean }[] = [];
  if (justWonRoundId != null)
    prizeRows.push({ roundId: justWonRoundId, amount: unsettledWin, isRefund: false });
  for (const w of (winsData ?? []) as readonly {
    roundId: bigint;
    amount: bigint;
    claimed: boolean;
    isRefund: boolean;
  }[]) {
    if (w.claimed || w.amount === 0n) continue;
    const roundId = Number(w.roundId);
    if (prizeRows.some((r) => r.roundId === roundId)) continue; // dedupe synthetic
    prizeRows.push({
      roundId,
      amount: Number(formatUnits(w.amount, dec)),
      isRefund: w.isRefund,
    });
  }
  prizeRows.sort((a, b) => b.roundId - a.roundId);

  // An expired round isn't settled on-chain until the next bet/claim, but we
  // present the board as the NEXT round already waiting — so the game never
  // looks stuck on a finished round, with or without the winner claiming.
  // (The just-ended winner's pot stays parked in the claim card below.)
  const heroWaiting = waiting || expired;
  const displayRoundNo = round ? round.id + 1 + (expired ? 1 : 0) : null;
  const displayPrizePool = expired ? 0 : prizePool;
  const displayBurned = expired ? 0 : burned;
  // Count-up on page load (and whenever the on-chain values move).
  const animPrizePool = useCountUp(displayPrizePool);
  const animBurned = useCountUp(displayBurned);
  const displayBetCount = round && !expired ? round.betCount : expired ? 0 : null;
  const displayLastBettor = expired ? null : lastBettor;

  // Recent bets + round history straight from contract events.
  const { data: recentBets } = useQuery({
    queryKey: ["lms-recent-bets", contract, round?.id],
    enabled: !!publicClient && round != null,
    refetchInterval: 10_000,
    queryFn: async () => {
      const logs = await publicClient!.getContractEvents({
        address: contract,
        abi: LMS_ABI,
        eventName: "BetPlaced",
        args: { roundId: BigInt(round!.id) },
        fromBlock: LMS_FROM_BLOCK,
        toBlock: "latest",
      });
      return logs
        .slice(-12)
        .reverse()
        .map((log) => ({
          key: `${log.transactionHash}-${log.logIndex}`,
          bettor: (log.args.bettor ?? ZERO_ADDR) as string,
          amount: Number(formatUnits(log.args.amount ?? 0n, dec)),
          block: Number(log.blockNumber ?? 0n),
        }));
    },
  });

  const { data: history } = useQuery({
    queryKey: ["lms-history", contract, round?.id],
    enabled: !!publicClient && round != null,
    refetchInterval: 30_000,
    queryFn: async () => {
      const logs = await publicClient!.getContractEvents({
        address: contract,
        abi: LMS_ABI,
        eventName: "RoundSettled",
        fromBlock: LMS_FROM_BLOCK,
        toBlock: "latest",
      });
      return logs
        .slice(-5)
        .reverse()
        .map((log) => ({
          roundId: Number(log.args.id ?? 0n),
          winner: (log.args.winner ?? ZERO_ADDR) as string,
          prize: Number(formatUnits(log.args.prize ?? 0n, dec)),
          block: Number(log.blockNumber ?? 0n),
        }));
    },
  });

  const refreshAll = () => queryClient.invalidateQueries();

  // Recent bets belong to the round being settled — once it ends we present a
  // fresh round, so the list reads empty until the new round takes bets.
  const shownBets = expired ? [] : (recentBets ?? []);

  const requireWallet = (): boolean => {
    if (!wallet || !publicClient) {
      toast.error("Connect your wallet");
      return false;
    }
    if (!onXphere) {
      toast.error("Switch your wallet network to Xphere");
      return false;
    }
    return true;
  };

  // Tier model: the bet is FIXED to the current on-chain minimum (no choice).
  const betAmt = minBet;
  const overBalance = hydrated && connected && betAmt > kang;
  // An expired pot goes to its winner — a bet now opens a FRESH round.
  const previewPrize =
    betAmt > 0 ? (expired ? 0 : prizePool) + betAmt * LMS_CONFIG.FEE_PRIZE : 0;

  const doBet = async () => {
    if (!requireWallet() || !round || !kangAddr) return;
    try {
      setBusy("bet");
      // The min bet doubles every 10 bets; minBetWei is on a 30s poll, so at a
      // tier boundary it can be one tier stale (too low) and the bet reverts.
      // Re-read it fresh so the approval and the bet both use the live floor.
      const { data: freshMinBet } = await refetchMinBet();
      const amountWei =
        freshMinBet ?? minBetWei ?? parseUnits(String(betAmt), dec);
      const allowance = await publicClient!.readContract({
        address: kangAddr,
        abi: erc20Abi,
        functionName: "allowance",
        args: [wallet!, contract],
      });
      if (allowance < amountWei) {
        // One-time unlimited approve: later bets skip straight to the single
        // bet() signature instead of paying approve gas every round.
        toast.info(
          "One-time approval of KANGTEST1 spend… confirm in your wallet",
        );
        const approveHash = await sendTx({
          address: kangAddr,
          abi: erc20Abi,
          functionName: "approve",
          args: [contract, maxUint256],
        });
        await publicClient!.waitForTransactionReceipt({ hash: approveHash });
      }
      toast.info("Please approve the bet transaction in your wallet");
      const hash = await sendTx({
        address: contract,
        abi: LMS_ABI,
        functionName: "bet",
        args: [amountWei],
      });
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") return toast.error("Bet failed");
      toast.success(
        `Bet ${betAmt.toLocaleString()} KANGTEST1 placed · timer extended`,
      );
      refreshAll();
    } catch {
      toast.error("Bet failed: round expired, insufficient balance, or rejected in wallet");
    } finally {
      setBusy(null);
    }
  };

  // Claim a single winning round.
  const doClaimRound = async (roundId: number, amount: number) => {
    if (!requireWallet()) return;
    try {
      setBusy(`claim:${roundId}`);
      toast.info(`Approve claim for round #${roundId} prize in your wallet`);
      const hash = await sendTx({
        address: contract,
        abi: LMS_ABI,
        functionName: "claimRound",
        args: [BigInt(roundId)],
      });
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") return toast.error("Claim failed");
      toast.success(`Round #${roundId} · Claimed ${amount.toLocaleString()} KANGTEST1!`);
      refreshAll();
    } catch {
      toast.error("Claim failed: rejected in wallet or nothing to claim");
    } finally {
      setBusy(null);
    }
  };

  // Claim every unclaimed round in one tx.
  const doClaimAll = async () => {
    if (!requireWallet()) return;
    try {
      setBusy("claim-all");
      toast.info("Approve claim-all transaction in your wallet");
      const hash = await sendTx({
        address: contract,
        abi: LMS_ABI,
        functionName: "claimAll",
      });
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") return toast.error("Claim failed");
      toast.success(`Claimed all ${claimable.toLocaleString()} KANGTEST1!`);
      refreshAll();
    } catch {
      toast.error("Claim failed: rejected in wallet or nothing to claim");
    } finally {
      setBusy(null);
    }
  };


  // Betting on an expired round is fine — bet() settles it and opens the next.
  // minBetWei/isPaused must have actually loaded — while they're undefined the
  // guards would otherwise pass with minBet=0 and submit a 0 KANGTEST1 bet.
  const canBet =
    round != null &&
    minBetWei != null &&
    isPaused === false &&
    !overBalance &&
    betAmt >= minBet;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Title row */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="grad-text text-2xl font-bold tracking-tight">
                Last Man Standing
              </h1>
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[var(--up)]/40 bg-[var(--up-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--up)]">
                {displayRoundNo != null ? `Round #${displayRoundNo}` : "…"}
              </span>
            </div>
            <p className="text-sm text-[var(--muted)]">
              Place a bet. Reset the timer. Last bettor wins the pool.
            </p>
          </div>
        </div>

      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_340px]">
        {/* Main column: timer / stats / bet / fee / tiers */}
        <div className="flex flex-col gap-4 max-md:contents">
          {/* Countdown card — full width. The max-md:-order-* classes on this
              and the next three cards pin the mobile stack to: countdown →
              stats → bet → pixel arena (both columns flatten via contents). */}
          <div className="burnband max-md:-order-6 flex flex-col items-center justify-center rounded-3xl border border-[var(--border)] bg-[var(--card)] p-6 text-center shadow-2xl">
            <span aria-hidden className="ember" style={{ left: "2.0%", bottom: 0, width: 3, height: 3, background: "var(--dot-yellow)", animationDelay: "0.0s", animationDuration: "1.2s" }} />
            <span aria-hidden className="ember" style={{ left: "5.7%", bottom: 5, animationDelay: "0.37s", animationDuration: "1.31s" }} />
            <span aria-hidden className="ember" style={{ left: "9.4%", bottom: 10, width: 3, height: 3, background: "var(--accent)", animationDelay: "0.74s", animationDuration: "1.42s" }} />
            <span aria-hidden className="ember" style={{ left: "13.1%", bottom: 0, background: "var(--dot-yellow)", animationDelay: "1.11s", animationDuration: "1.53s" }} />
            <span aria-hidden className="ember" style={{ left: "16.8%", bottom: 5, width: 3, height: 3, animationDelay: "1.48s", animationDuration: "1.64s" }} />
            <span aria-hidden className="ember" style={{ left: "20.5%", bottom: 10, background: "var(--accent)", animationDelay: "1.85s", animationDuration: "1.75s" }} />
            <span aria-hidden className="ember" style={{ left: "24.2%", bottom: 0, width: 3, height: 3, background: "var(--dot-yellow)", animationDelay: "2.22s", animationDuration: "1.2s" }} />
            <span aria-hidden className="ember" style={{ left: "27.8%", bottom: 5, animationDelay: "0.19s", animationDuration: "1.31s" }} />
            <span aria-hidden className="ember" style={{ left: "31.5%", bottom: 10, width: 3, height: 3, background: "var(--accent)", animationDelay: "0.56s", animationDuration: "1.42s" }} />
            <span aria-hidden className="ember" style={{ left: "35.2%", bottom: 0, background: "var(--dot-yellow)", animationDelay: "0.93s", animationDuration: "1.53s" }} />
            <span aria-hidden className="ember" style={{ left: "38.9%", bottom: 5, width: 3, height: 3, animationDelay: "1.3s", animationDuration: "1.64s" }} />
            <span aria-hidden className="ember" style={{ left: "42.6%", bottom: 10, background: "var(--accent)", animationDelay: "1.67s", animationDuration: "1.75s" }} />
            <span aria-hidden className="ember" style={{ left: "46.3%", bottom: 0, width: 3, height: 3, background: "var(--dot-yellow)", animationDelay: "2.04s", animationDuration: "1.2s" }} />
            <span aria-hidden className="ember" style={{ left: "50.0%", bottom: 5, animationDelay: "0.01s", animationDuration: "1.31s" }} />
            <span aria-hidden className="ember" style={{ left: "53.7%", bottom: 10, width: 3, height: 3, background: "var(--accent)", animationDelay: "0.38s", animationDuration: "1.42s" }} />
            <span aria-hidden className="ember" style={{ left: "57.4%", bottom: 0, background: "var(--dot-yellow)", animationDelay: "0.75s", animationDuration: "1.53s" }} />
            <span aria-hidden className="ember" style={{ left: "61.1%", bottom: 5, width: 3, height: 3, animationDelay: "1.12s", animationDuration: "1.64s" }} />
            <span aria-hidden className="ember" style={{ left: "64.8%", bottom: 10, background: "var(--accent)", animationDelay: "1.49s", animationDuration: "1.75s" }} />
            <span aria-hidden className="ember" style={{ left: "68.5%", bottom: 0, width: 3, height: 3, background: "var(--dot-yellow)", animationDelay: "1.86s", animationDuration: "1.2s" }} />
            <span aria-hidden className="ember" style={{ left: "72.2%", bottom: 5, animationDelay: "2.23s", animationDuration: "1.31s" }} />
            <span aria-hidden className="ember" style={{ left: "75.8%", bottom: 10, width: 3, height: 3, background: "var(--accent)", animationDelay: "0.2s", animationDuration: "1.42s" }} />
            <span aria-hidden className="ember" style={{ left: "79.5%", bottom: 0, background: "var(--dot-yellow)", animationDelay: "0.57s", animationDuration: "1.53s" }} />
            <span aria-hidden className="ember" style={{ left: "83.2%", bottom: 5, width: 3, height: 3, animationDelay: "0.94s", animationDuration: "1.64s" }} />
            <span aria-hidden className="ember" style={{ left: "86.9%", bottom: 10, background: "var(--accent)", animationDelay: "1.31s", animationDuration: "1.75s" }} />
            <span aria-hidden className="ember" style={{ left: "90.6%", bottom: 0, width: 3, height: 3, background: "var(--dot-yellow)", animationDelay: "1.68s", animationDuration: "1.2s" }} />
            <span aria-hidden className="ember" style={{ left: "94.3%", bottom: 5, animationDelay: "2.05s", animationDuration: "1.31s" }} />
            <span aria-hidden className="ember" style={{ left: "98.0%", bottom: 10, width: 3, height: 3, background: "var(--accent)", animationDelay: "0.02s", animationDuration: "1.42s" }} />
            <span className="mb-3 text-xs font-medium text-[var(--muted)]">
              {heroWaiting ? "Round timer" : "Time Remaining"}
            </span>
            <div
              className={`font-mono text-5xl font-bold tabular-nums leading-none sm:text-6xl ${
                !heroWaiting && remainingMs < 10_000 ? "" : "burn-digits"
              }`}
              style={
                !heroWaiting && remainingMs < 10_000
                  ? { color: "var(--down)" }
                  : undefined
              }
            >
              {heroWaiting
                ? hhmmss(
                    tierDurationSec != null
                      ? Number(tierDurationSec) * 1000
                      : Math.max(30_000, Math.floor(86_400_000 / 2 ** tier)),
                  )
                : hhmmss(remainingMs)}
            </div>
            {waiting && (
              <p className="mt-3 text-xs text-[var(--muted)]">
                The timer starts when the first bet is placed
              </p>
            )}
            {expired && (
              <p className="mt-3 text-xs text-[var(--muted)]">
                Previous round ended · First bet starts a new round
                {unsettledWin > 0 && " · Your prize is ready to claim below"}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-sm text-[var(--muted)]">
              {displayLastBettor ? (
                <span>
                  Last bettor:{" "}
                  <span className="font-mono font-medium text-[var(--foreground)]">
                    {shortAddress(displayLastBettor)}
                    {wallet &&
                      displayLastBettor.toLowerCase() ===
                        wallet.toLowerCase() && (
                        <span className="ml-1.5 inline-flex items-center rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-bold text-[var(--accent)]">
                          YOU
                        </span>
                      )}
                  </span>
                </span>
              ) : (
                <span>No bets yet</span>
              )}
              <span className="text-[var(--muted-2)]">·</span>
              <span>
                Total bets{" "}
                <span className="font-mono font-medium text-[var(--foreground)]">
                  {displayBetCount ?? 0}
                </span>{" "}
                this round
              </span>
            </div>
          </div>

          {/* Stats row: burned (1) + prize pool (2) */}
          <div className="max-md:-order-5 grid gap-4 sm:grid-cols-3">
            <StatCard
              icon={<Flame className="flamebob h-5 w-5" stroke="url(#flame-grad)" fill="url(#flame-grad)" />}
              label="Burned"
              value={formatNumber(animBurned, 2)}
          unit="KANGTEST1"
              valueColor="var(--accent)"
              motion="embers"
            />
            <StatCard
              icon={<TrendingUp className="h-5 w-5" />}
              label="Prize Pool"
              value={formatNumber(animPrizePool, 2)}
          unit="KANGTEST1"
              accent
              valueColor="var(--accent-bright)"
              motion="beam"
              className="sm:col-span-2"
            />
          </div>

          {/* Place Your Bet card */}
          <div className="max-md:-order-4 rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 sm:p-7 shadow-2xl">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="shrink-0 text-base font-semibold">Place Your Bet</h2>
              <AddToWalletButton symbol="KANGTEST1" />
            </div>

            <div className="rounded-2xl bg-[var(--surface)] p-4 sm:flex sm:items-center sm:justify-between sm:gap-6">
              <div>
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-[13px] text-[var(--muted)]">
                    Bet · Tier {tier}
                  </span>
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-semibold">
                      {hydrated ? formatNumber(minBet, 0) : "…"}
                    </span>
                    <span className="text-sm font-semibold text-[var(--muted)]">
                      KANGTEST1
                    </span>
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted-2)]">
                  Fixed to the active tier minimum · doubles every 10 bets
                  while the timer halves.
                </p>
              </div>

              {/* Action column — balance over the bet button */}
              <div className="mt-4 flex shrink-0 flex-col gap-2 sm:mt-0 sm:items-end">
                {hydrated && connected && (
                  <span className="text-xs text-[var(--muted)]">
                    Balance:{" "}
                    <span
                      className={
                        overBalance ? "font-semibold text-[var(--down)]" : ""
                      }
                    >
                      {formatNumber(kang, 2)} KANGTEST1
                    </span>
                  </span>
                )}
                {!hydrated ? (
                  <div className="h-11 w-44 rounded-full bg-[var(--surface-2)] animate-pulse-soft" />
                ) : !connected ? (
                  <button
                    onClick={() => openWalletModal()}
                    className="h-11 min-w-[210px] rounded-full bg-[var(--accent)] px-8 text-sm font-semibold text-white transition-all hover:bg-[var(--accent-hover)] active:scale-[0.985]"
                  >
                    Connect Wallet
                  </button>
                ) : (
                  <button
                    onClick={doBet}
                    disabled={!canBet || busy !== null}
                    className="flex h-11 min-w-[210px] items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[var(--accent)] px-8 text-sm font-semibold text-white transition-all hover:bg-[var(--accent-hover)] active:scale-[0.985] disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--muted-2)]"
                  >
                    {busy === "bet" && <Loader2 className="h-5 w-5 animate-spin" />}
                    {busy === "bet"
                      ? "Betting…"
                      : !round
                        ? "Loading round…"
                        : isPaused
                          ? "Game paused"
                          : overBalance
                            ? "Insufficient KANGTEST1"
                            : betAmt < minBet
                              ? `Minimum ${minBet.toLocaleString()} KANGTEST1`
                              : expired
                                ? (
                                    <>
                                      Bet {betAmt.toLocaleString()}{" "}
                                      <span className="text-xs font-normal opacity-90">
                                        KANGTEST1
                                      </span>{" "}
                                      · starts new round
                                    </>
                                  )
                                : (
                                    <>
                                      Bet {betAmt.toLocaleString()}{" "}
                                      <span className="text-xs font-normal opacity-90">
                                        KANGTEST1
                                      </span>
                                    </>
                                  )}
                  </button>
                )}
              </div>
            </div>

            {/* Payout preview — one line under the action button */}
            <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] px-4 py-3 text-sm">
              <span className="text-[var(--muted)]">
                Payout if you hold the last bet
                <span className="hidden text-xs text-[var(--muted-2)] lg:inline">
                  {" "}
                  · 80% of every bet feeds the pool
                </span>
              </span>
              <span className="whitespace-nowrap font-medium">
                {betAmt > 0 ? `${formatNumber(previewPrize, 2)} KANGTEST1` : "0 KANGTEST1"}
              </span>
            </div>
          </div>

            {/* Fee distribution bar — reference info */}
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5">
              <h3 className="text-sm font-semibold mb-3">Fee Distribution</h3>
              <div className="flex h-3 w-full overflow-hidden rounded-full">
                <div
                  className="h-full"
                  style={{ width: "80%", backgroundColor: "var(--accent-bright)" }}
                  title="80% Prize Pool"
                />
                <div
                  className="h-full"
                  style={{ width: "15%", backgroundColor: "var(--treasury)" }}
                  title="15% Treasury"
                />
                <div
                  className="h-full"
                  style={{ width: "5%", backgroundColor: "var(--burn)" }}
                  title="5% Burn"
                />
              </div>
              <div className="mt-3 grid gap-3 text-xs text-[var(--muted)] sm:grid-cols-3">
                <LegendRow
                  color="var(--accent-bright)"
                  label="Prize"
                  pct="80%"
                  address={LMS_CONTRACT}
                />
                <LegendRow
                  color="var(--treasury)"
                  label="Treasury"
                  pct="15%"
                  address={FEE_WALLETS.treasury}
                />
                <LegendRow
                  color="var(--burn)"
                  label="Burn"
                  pct="5%"
                  address={FEE_WALLETS.burn}
                />
              </div>
            </div>
          {/* Timer Tiers — standalone reference card, full width */}
          <TierTable tier={tier} />
        </div>

        {/* Right column: pixel arena + recent bets + round history */}
        <div className="flex flex-col gap-4 max-md:contents">
          {/* Gold Babel pixel arena — portrait card that stretches as bets
              stack up (300px empty round → 780px cap at 60 bets). On mobile
              it slots directly under the bet card (see -order notes above). */}
          <div className="max-md:-order-3 rounded-3xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-2xl">
            <div
              className="relative overflow-hidden rounded-2xl border border-[var(--border)] transition-[height] duration-700 ease-out"
              style={{
                height: `${Math.min(780, 300 + (displayBetCount ?? 0) * 8)}px`,
              }}
            >
              <PixelArena
                tier={tier}
                betCount={displayBetCount ?? 0}
                lastBettor={displayLastBettor}
                active={!heroWaiting}
              />
              {/* Stage · tier badge — top right, over the sky */}
              <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-[rgba(255,151,56,0.6)] bg-black/55 px-2.5 py-1 font-mono text-xs font-semibold text-[var(--accent-bright)]">
                <span className="dot-live h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                {ARENA_STAGE_NAMES[Math.min(5, tier)]} · TIER {tier}
              </span>
            </div>
          </div>

          {/* Your Prizes — compact pull-payment claims, one row per winning
              round (claimRound). A just-won pot settles when claimed. */}
          {hydrated && connected && prizeRows.length > 0 && (
            <div className="relative overflow-hidden rounded-3xl border border-[var(--accent)]/40 bg-[var(--card)] p-4">
              <span aria-hidden className="beam-ring" />
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Trophy className="h-3.5 w-3.5 text-[var(--accent-bright)]" />
                  <h3 className="text-sm font-semibold">Your Prizes</h3>
                </div>
                {prizeRows.length > 1 ? (
                  <button
                    onClick={doClaimAll}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent)]/40 px-2.5 py-1 text-xs font-semibold text-[var(--accent-bright)] transition-colors hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy === "claim-all" && (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    )}
                    {busy === "claim-all"
                      ? "Claiming…"
                      : `Claim all · ${formatNumber(claimable, 2)}`}
                  </button>
                ) : (
                  <span className="text-xs text-[var(--muted-2)]">
                    Round #{prizeRows[0].roundId}
                    {prizeRows[0].isRefund ? " · Refund" : ""}
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                {prizeRows.map((row) => (
                  <div
                    key={row.roundId}
                    className="flex items-center justify-between gap-2 rounded-xl bg-[var(--surface)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      {/* Prize Pool 스탯 카드와 동일한 수량 표기 — mono 앰버,
                          티커는 한 단계 작고 얇게 */}
                      <div className="truncate font-mono text-sm tabular-nums text-[var(--accent-bright)]">
                        {formatNumber(row.amount, 2)}
                        <span className="ml-1 text-xs font-light opacity-85">
                          KANGTEST1
                        </span>
                      </div>
                      {/* 상금 1건이면 라운드·환불 표기는 헤더 오른쪽에 있음 */}
                      {prizeRows.length > 1 && (
                        <div className="text-xs text-[var(--muted-2)]">
                          Round #{row.roundId}
                          {row.isRefund ? " · Refund" : ""}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => doClaimRound(row.roundId, row.amount)}
                      disabled={busy !== null}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busy === `claim:${row.roundId}` && (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      {busy === `claim:${row.roundId}` ? "Claiming…" : "Claim"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Bets */}
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Recent Bets</h3>
              <span className="text-xs text-[var(--muted-2)]">Latest 12</span>
            </div>
            {shownBets.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[var(--border)] px-3 py-6 text-center text-xs text-[var(--muted-2)]">
                No bets yet · be the first.
              </p>
            ) : (
              <div className="space-y-1.5">
                <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-2 pb-1 text-xs text-[var(--muted-2)]">
                  <span>Address</span>
                  <span>Amount</span>
                  <span>Block</span>
                </div>
                {shownBets.map((bet) => (
                  <div
                    key={bet.key}
                    className="grid grid-cols-[1fr_auto_auto] gap-2 items-center rounded-xl px-2 py-1.5 text-xs"
                  >
                    <span className="font-mono">
                      {shortAddress(bet.bettor)}
                      {wallet &&
                        bet.bettor.toLowerCase() === wallet.toLowerCase() && (
                          <span className="ml-1 inline-flex items-center rounded-full bg-[var(--accent-soft)] px-1.5 py-px text-[9px] font-bold text-[var(--accent)]">
                            YOU
                          </span>
                        )}
                    </span>
                    <span className="font-medium text-right">
                      {formatNumber(bet.amount, 2)}
                    </span>
                    <span className="text-[var(--muted-2)] text-right font-mono text-xs">
                      {bet.block}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Round History */}
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5">
            <h3 className="text-sm font-semibold mb-3">Round History</h3>
            {!history || history.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[var(--border)] px-3 py-6 text-center text-xs text-[var(--muted-2)]">
                First round in progress.
              </p>
            ) : (
              <div className="space-y-1.5">
                <div className="grid grid-cols-[auto_1fr_auto] gap-2 px-2 pb-1 text-xs text-[var(--muted-2)]">
                  <span>Round</span>
                  <span>Winner</span>
                  <span>Prize</span>
                </div>
                {history.map((h) => (
                  <div
                    key={h.roundId}
                    className="grid grid-cols-[auto_1fr_auto] gap-2 items-center rounded-xl px-2 py-1.5 text-xs"
                  >
                    <span className="font-mono text-[var(--muted-2)] text-xs">
                      #{h.roundId + 1}
                    </span>
                    <span className="font-mono truncate">
                      {h.winner !== ZERO_ADDR ? shortAddress(h.winner) : "Refund"}
                    </span>
                    <span className="font-medium text-right">
                      {formatNumber(h.prize, 2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LegendRow({
  color,
  label,
  pct,
  address,
}: {
  color: string;
  label: string;
  pct: string;
  address?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        {label} {pct}
      </span>
      {address && (
        <a
          href={`${EXPLORER}/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          title={address}
          className="font-mono text-[var(--muted-2)] underline decoration-[var(--border-strong)] underline-offset-4 transition-colors hover:text-[var(--foreground)]"
        >
          {shortAddress(address)}
        </a>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  unit,
  detail,
  accent,
  valueColor,
  motion,
  className = "",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  /** 토큰 티커 등 단위 — 숫자보다 2px 작고 한 단계 얇게 붙는다 */
  unit?: string;
  detail?: string;
  accent?: boolean;
  valueColor?: string;
  /** ambient motion — "embers": 잔불 상승 + 히트 글로우(Burned),
      "beam": 테두리를 도는 골드 빛줄기(Prize Pool) */
  motion?: "embers" | "beam";
  className?: string;
}) {
  return (
    <div
      className={`dotgrid lift-card group rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 ${
        motion === "embers" ? "lift-red" : ""
      } ${className}`}
    >
      {motion === "embers" && (
        <>
          <span aria-hidden className="heat-glow" />
          <span aria-hidden className="mini-ember" style={{ left: "12%", animationDelay: "0s" }} />
          <span aria-hidden className="mini-ember" style={{ left: "28%", width: 2, height: 2, background: "var(--dot-yellow)", animationDelay: "0.7s" }} />
          <span aria-hidden className="mini-ember" style={{ left: "45%", animationDelay: "1.3s" }} />
          <span aria-hidden className="mini-ember" style={{ left: "62%", width: 2, height: 2, animationDelay: "0.4s" }} />
          <span aria-hidden className="mini-ember" style={{ left: "78%", background: "var(--dot-yellow)", animationDelay: "1.7s" }} />
          <span aria-hidden className="mini-ember" style={{ left: "90%", width: 2, height: 2, animationDelay: "1s" }} />
        </>
      )}
      {motion === "beam" && <span aria-hidden className="beam-ring" />}
      <div className="relative z-[1] flex items-center justify-between gap-3">
        {/* valueColor cards (Prize Pool / Burned): bare icon, no tile plate,
            and the label matches the number's color. */}
        <div
          className="flex items-center gap-2.5 text-sm"
          style={{ color: valueColor ?? "var(--muted)" }}
        >
          {valueColor ? (
            <span className="flex h-5 w-5 items-center justify-center">
              {icon}
            </span>
          ) : (
            <span
              className="icontile"
              style={{ color: accent ? "var(--accent)" : "var(--muted)" }}
            >
              {icon}
            </span>
          )}
          {label}
        </div>
        <div className="text-right">
          <div
            className="font-mono text-sm tabular-nums"
            style={{
              color: valueColor ?? (accent ? "var(--accent)" : "var(--foreground)"),
            }}
          >
            {value}
            {unit && (
              <span className="ml-1 text-xs font-light opacity-85">{unit}</span>
            )}
          </div>
          {detail && (
            <div className="mt-0.5 text-xs text-[var(--muted-2)]">{detail}</div>
          )}
        </div>
      </div>
    </div>
  );
}
