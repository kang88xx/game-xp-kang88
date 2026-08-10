"use client";

import { useMemo, useState } from "react";
import { erc20Abi, formatUnits, parseUnits, parseEventLogs } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useWriteContract,
} from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck,
  Lock,
  Plus,
  Trash2,
  LogOut,
  UserPlus,
  X,
  Power,
  Coins,
  Droplets,
  Check,
  Users,
  Wallet,
  TrendingUp,
  ListFilter,
  Rocket,
  Loader2,
} from "lucide-react";
import { useDexStore, useHydrated } from "@/lib/store";
import { useTokenRegistry, tokenTradable } from "@/lib/token-registry";
import { usePoolStats } from "@/lib/pool-stats";
import { CHAIN_ID, NATIVE_SYMBOL } from "@/lib/chain";
import { TOKEN_MAP } from "@/lib/tokens";
import { merkleRoot } from "@/lib/merkle";
import { AIRDROP_ABI, AIRDROP_CONTRACT, NATIVE_TOKEN, airdropLive } from "@/lib/airdrop";
import {
  daysUntil,
  formatUsd,
  shortAddress,
  formatAmountInput,
  parseAmountInput,
} from "@/lib/format";
import { TokenLogo, TokenPair } from "@/components/TokenLogo";
import { toast } from "@/components/toast";
import { Eyebrow } from "@/components/ui";
import type { AirdropCampaign, Eligibility } from "@/lib/types";

const DAY = 1000 * 60 * 60 * 24;

const INPUT =
  "w-full rounded-xl border border-[var(--border-strong)] bg-[var(--card)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => {
    const m: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return m[c];
  });

/**
 * Opens a standalone HTML window listing a campaign's claim recipients —
 * wallet, allocated amount (allocated), received amount (received) — with a
 * client-side address search box. Whitelist campaigns expose per-wallet data;
 * others only track an aggregate count.
 */
function openClaimDetail(
  c: AirdropCampaign,
  receivedRows?: { address: string; allocated: number; received: number }[],
) {
  const isWl = c.eligibility === "whitelist";
  const rows = isWl
    ? (
        receivedRows ??
        c.whitelist.map((w) => ({
          address: w.address,
          allocated: w.amount,
          received: w.claimed ? w.amount : 0,
        }))
      ).map((r) => ({
        ...r,
        claimed: r.received > 0,
        full: r.received > 0 && r.received >= r.allocated,
      }))
    : [];
  const totalAlloc = rows.reduce((s, r) => s + r.allocated, 0);
  const totalRecv = rows.reduce((s, r) => s + r.received, 0);
  const claimedCount = rows.filter((r) => r.claimed).length;
  const sym = esc(c.tokenSymbol);
  const note = isWl
    ? `${claimedCount}/${rows.length} claimed · Allocated total ${totalAlloc.toLocaleString()} ${sym} · Received total ${totalRecv.toLocaleString()} ${sym}`
    : `This campaign does not track per-wallet claim history (whitelist campaigns only) · ${c.claimedCount} total claims`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${esc(c.name)} · Claim History</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px;
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #0b0d12; color: #e7e9ee; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.sub { margin: 0 0 18px; color: #8a91a0; font-size: 13px; }
  input.search { width: 100%; max-width: 420px; margin-bottom: 18px;
    padding: 9px 14px; border-radius: 999px; border: 1px solid #232838;
    background: #11151f; color: #e7e9ee; font: inherit; font-size: 13px; outline: none; }
  input.search:focus { border-color: #6366f1; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  thead th { text-align: left; font-size: 12px; font-weight: 600; color: #8a91a0;
    padding: 10px 12px; border-bottom: 1px solid #232838; }
  thead th.num, tbody td.num { text-align: right; }
  tbody td { padding: 10px 12px; border-bottom: 1px solid #161b27; }
  tbody tr:hover { background: #11151f; }
  td.addr { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  td.empty { text-align: center; color: #6b7384; padding: 40px 12px; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .pill.y { background: rgba(34,197,94,.15); color: #4ade80; }
  .pill.p { background: rgba(245,158,11,.15); color: #fbbf24; }
  .pill.n { background: #1b2030; color: #8a91a0; }
</style>
</head>
<body>
  <h1>${esc(c.name)} · Claim History</h1>
  <p class="sub">${note}</p>
  <input id="q" class="search" type="search" placeholder="Search wallet address…" autocomplete="off" />
  <table>
    <thead><tr>
      <th>Wallet Address</th>
      <th class="num">Allocated</th>
      <th class="num">Received</th>
      <th>Status</th>
    </tr></thead>
    <tbody id="rows"></tbody>
  </table>
<script>
  var SYM = ${JSON.stringify(c.tokenSymbol)};
  var ROWS = ${JSON.stringify(rows)};
  function fmt(n) { return Number(n).toLocaleString(); }
  function render(q) {
    q = (q || "").trim().toLowerCase();
    var list = q ? ROWS.filter(function (r) { return r.address.toLowerCase().indexOf(q) !== -1; }) : ROWS;
    var body = document.getElementById("rows");
    if (!list.length) {
      body.innerHTML = '<tr><td class="empty" colspan="4">' +
        (ROWS.length ? "No results found." : "No records.") + "</td></tr>";
      return;
    }
    body.innerHTML = list.map(function (r) {
      var pill = r.full
        ? '<span class="pill y">Received</span>'
        : r.claimed
          ? '<span class="pill p">Partial</span>'
          : '<span class="pill n">Pending</span>';
      return "<tr><td class='addr'>" + r.address +
        "</td><td class='num'>" + fmt(r.allocated) + " " + SYM +
        "</td><td class='num'>" + fmt(r.received) + " " + SYM +
        "</td><td>" + pill + "</td></tr>";
    }).join("");
  }
  document.getElementById("q").addEventListener("input", function (e) { render(e.target.value); });
  render("");
</script>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

interface WlClaimStatus {
  /** lowercased wallet → tokens already received (token units). */
  received: Record<string, number>;
  /** Contract exposes per-wallet claimed amounts (v5+) → top-ups claimable. */
  supportsPartial: boolean;
  loaded: boolean;
}

const NO_WL: AirdropCampaign["whitelist"] = [];

/**
 * On-chain claim status for a launched whitelist campaign — one multicall over
 * the whole list, so the Received/Pending pills and counters follow the chain
 * automatically instead of a hand-maintained local flag. Reads the v5
 * claimedAmount (exact cumulative amount) alongside the v4 boolean hasClaimed;
 * whichever the deployed contract supports wins.
 */
function useWhitelistClaimStatus(c: AirdropCampaign): WlClaimStatus {
  const launched =
    c.onchainId != null && airdropLive && c.eligibility === "whitelist";
  const entries = launched ? c.whitelist : NO_WL;
  const contract = AIRDROP_CONTRACT as `0x${string}`;
  const decimals = TOKEN_MAP[c.tokenSymbol]?.decimals ?? 18;

  const { data } = useReadContracts({
    contracts: entries.flatMap((w) => [
      {
        address: contract,
        abi: AIRDROP_ABI,
        functionName: "claimedAmount" as const,
        args: [BigInt(c.onchainId ?? 0), w.address as `0x${string}`] as const,
        chainId: CHAIN_ID,
      },
      {
        address: contract,
        abi: AIRDROP_ABI,
        functionName: "hasClaimed" as const,
        args: [BigInt(c.onchainId ?? 0), w.address as `0x${string}`] as const,
        chainId: CHAIN_ID,
      },
    ]),
    query: { enabled: entries.length > 0, refetchInterval: 15_000 },
  });

  return useMemo(() => {
    const received: Record<string, number> = {};
    let supportsPartial = false;
    entries.forEach((w, i) => {
      const amt = data?.[i * 2];
      const flag = data?.[i * 2 + 1];
      if (amt?.status === "success") {
        supportsPartial = true;
        received[w.address.toLowerCase()] = Number(
          formatUnits(amt.result as bigint, decimals),
        );
      } else if (flag?.status === "success") {
        received[w.address.toLowerCase()] = (flag.result as boolean)
          ? w.amount
          : 0;
      }
    });
    return { received, supportsPartial, loaded: data != null };
  }, [data, entries, decimals]);
}

/** Server-verified admin session (HTTP-only cookie, see /api/admin/*) */
function useAdminSession() {
  return useQuery<{ isAdmin: boolean }>({
    queryKey: ["admin-session"],
    queryFn: async () => {
      const res = await fetch("/api/admin/session");
      if (!res.ok) return { isAdmin: false };
      return res.json();
    },
    staleTime: 60_000,
  });
}

export default function AdminPage() {
  const hydrated = useHydrated();
  const { data: session, isLoading } = useAdminSession();

  if (!hydrated || isLoading) {
    return (
      <div className="mx-auto max-w-md px-4 py-24">
        <div className="h-72 rounded-3xl bg-[var(--surface-2)] animate-pulse-soft" />
      </div>
    );
  }

  return session?.isAdmin ? <AdminDashboard /> : <AdminLogin />;
}

function AdminLogin() {
  const queryClient = useQueryClient();
  const [pw, setPw] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        toast.success("Admin access granted");
        await queryClient.invalidateQueries({ queryKey: ["admin-session"] });
      } else {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        toast.error(body?.error ?? "Login failed");
        setPw("");
      }
    } catch {
      toast.error("Login failed — network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-soft)]">
        <Lock className="h-7 w-7 text-[var(--accent)]" />
      </span>
      <h1 className="mt-5 text-xl font-bold">Admin access</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Manage airdrop campaigns and whitelists.
      </p>
      <form onSubmit={submit} className="mt-6 w-full">
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Enter admin password"
          className="w-full rounded-2xl border border-[var(--border-strong)] px-4 py-3 text-sm outline-none focus:border-[var(--accent)]"
        />
        <button
          type="submit"
          disabled={submitting}
          className="mt-3 w-full rounded-2xl bg-[var(--accent)] py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}

function AdminDashboard() {
  const campaigns = useDexStore((s) => s.campaigns);
  const queryClient = useQueryClient();
  // Ended campaigns (swept/expired) collapse into their own section — they
  // stay as records but stop eating space in the working list.
  const [showEnded, setShowEnded] = useState(false);
  const live = campaigns.filter((c) => !isPastMs(c.endsAt));
  const ended = campaigns.filter((c) => isPastMs(c.endsAt));

  const logout = async () => {
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
    toast.info("Logged out of admin");
    await queryClient.invalidateQueries({ queryKey: ["admin-session"] });
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Eyebrow dot="orange" className="mb-4">
        Admin Console
      </Eyebrow>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent-soft)]">
            <ShieldCheck className="h-6 w-6 text-[var(--accent)]" />
          </span>
          <div>
            <h1 className="text-3xl font-medium tracking-tight">Admin Panel</h1>
            <p className="text-sm text-[var(--muted)]">
              {live.length} active · {ended.length} ended · manage rewards &
              whitelists
            </p>
          </div>
        </div>
        <button
          onClick={logout}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--surface)]"
        >
          <LogOut className="h-4 w-4" />
          Exit admin
        </button>
      </div>

      <AnalyticsPanel />

      <div className="mt-8 grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <CampaignForm />
        </div>
        <div className="lg:col-span-3">
          <h2 className="mb-3 text-sm font-semibold">Campaigns</h2>
          <div className="space-y-4">
            {live.map((c) => (
              <CampaignAdminRow key={c.id} campaign={c} />
            ))}
            {live.length === 0 && (
              <div className="rounded-3xl border border-dashed border-[var(--border-strong)] py-12 text-center text-sm text-[var(--muted)]">
                {ended.length > 0
                  ? "No active campaigns — create one on the left."
                  : "No campaigns yet — create one on the left."}
              </div>
            )}

            {/* Ended campaigns — collapsed record list (swept/expired). */}
            {ended.length > 0 && (
              <div>
                <button
                  onClick={() => setShowEnded((v) => !v)}
                  aria-expanded={showEnded}
                  className="flex w-full items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-medium text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                >
                  <span className="flex items-center gap-2">
                    <Check className="h-4 w-4" />
                    Ended campaigns ({ended.length})
                  </span>
                  <span className="text-xs">
                    {showEnded ? "Collapse ▲" : "Expand ▼"}
                  </span>
                </button>
                {showEnded && (
                  <div className="mt-3 space-y-4 opacity-75">
                    {ended.map((c) => (
                      <CampaignAdminRow key={c.id} campaign={c} />
                    ))}
                  </div>
                )}
              </div>
            )}

            <LegacySweepTool />
          </div>
        </div>
      </div>

      <div className="mt-10">
        <SwapTokensManager />
      </div>

      <div className="mt-10">
        <PoolsManager />
      </div>
    </div>
  );
}

// Last pre-v5 MerkleAirdrop deployment — prefilled in the recovery tool so
// sweeping a campaign stranded there is paste-free.
const LEGACY_AIRDROP_V4 = "0x755f35bf4fa91fda72301d7ce374b710bf87670b";

/**
 * Recovery console for campaigns stranded on a PREVIOUS airdrop contract
 * (env cutovers leave them unreachable from the campaign cards, which only
 * talk to the current contract). Calls endAndSweep(id, wallet) on any
 * MerkleAirdrop address with the connected owner wallet.
 */
function LegacySweepTool() {
  const { address: wallet, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [open, setOpen] = useState(false);
  const [contractAddr, setContractAddr] = useState(LEGACY_AIRDROP_V4);
  const [campaignId, setCampaignId] = useState("");
  const [busy, setBusy] = useState(false);

  const sweep = async () => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddr))
      return toast.error("Invalid contract address");
    const id = parseInt(campaignId, 10);
    if (!Number.isFinite(id) || id <= 0)
      return toast.error("Enter a numeric campaign ID");
    if (!wallet || !publicClient) return toast.error("Connect your wallet");
    if (chainId !== CHAIN_ID)
      return toast.error("Switch your wallet network to Xphere");
    try {
      setBusy(true);
      const target = contractAddr as `0x${string}`;
      const owner = (await publicClient.readContract({
        address: target,
        abi: AIRDROP_ABI,
        functionName: "owner",
      })) as string;
      if (owner.toLowerCase() !== wallet.toLowerCase())
        return toast.error(
          `Not the owner of this contract — connect with ${shortAddress(owner)} (current: ${shortAddress(wallet)})`,
        );
      toast.info("Submitting end & sweep transaction… confirm in your wallet");
      const hash = await writeContractAsync({
        address: target,
        abi: AIRDROP_ABI,
        functionName: "endAndSweep",
        args: [BigInt(id), wallet],
        chainId: CHAIN_ID,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") return toast.error("Transaction failed");
      toast.success(
        `Campaign #${id} swept — unclaimed tokens returned to your wallet`,
      );
      setCampaignId("");
    } catch {
      toast.error("Sweep failed — check address / campaign ID / remaining balance");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-medium text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
      >
        <span>Legacy Contract Sweep Tool</span>
        <span className="text-xs">{open ? "Collapse ▲" : "Expand ▼"}</span>
      </button>
      {open && (
        <div className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs leading-relaxed text-[var(--muted)]">
            Sweeps unclaimed tokens from campaigns on a replaced contract version.
            Connect with the owner wallet of that contract and enter the campaign ID —
            it will be ended immediately and remaining tokens sent to your wallet.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={contractAddr}
              onChange={(e) => setContractAddr(e.target.value.trim())}
              placeholder="0x… contract address"
              spellCheck={false}
              className={`${INPUT} font-mono text-xs sm:flex-1`}
            />
            <input
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              placeholder="Campaign ID"
              inputMode="numeric"
              className={`${INPUT} sm:w-28`}
            />
            <button
              onClick={sweep}
              disabled={busy}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--down)] px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {busy ? "Sweeping…" : "End + Sweep"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Admin management of liquidity pools (only pools that actually exist). */
function PoolsManager() {
  const pools = useDexStore((s) => s.pools);
  const hiddenPools = useDexStore((s) => s.hiddenPools);
  const addPool = useDexStore((s) => s.addPool);
  const removePool = useDexStore((s) => s.removePool);
  const setPoolVisible = useDexStore((s) => s.setPoolVisible);
  const { tradable } = useTokenRegistry();
  const symbols = tradable.map((t) => t.symbol);

  const [token0, setToken0] = useState(symbols[0] ?? "XP");
  const [token1, setToken1] = useState(symbols[1] ?? "USDT");
  const [feeTier, setFeeTier] = useState("0.25");
  // Delete goes through the password-gated confirm modal.
  const [deleteTarget, setDeleteTarget] = useState<(typeof pools)[number] | null>(
    null,
  );
  // TVL / volume / APR are computed live from on-chain reserves + 24h volume
  // (see usePoolStats), so they're no longer entered here — stored as 0.
  const stats = usePoolStats(pools);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (token0 === token1) return toast.error("Pick two different tokens");
    if (
      pools.some(
        (p) =>
          (p.token0 === token0 && p.token1 === token1) ||
          (p.token0 === token1 && p.token1 === token0),
      )
    )
      return toast.error(`${token0}/${token1} pool already exists`);
    const fee = parseFloat(feeTier);
    if (!Number.isFinite(fee) || fee < 0 || fee > 100)
      return toast.error("Fee must be 0–100%");

    addPool({ token0, token1, feeTier: fee, tvlUsd: 0, volume24h: 0, apr: 0 });
    toast.success(`Created ${token0}/${token1} pool`);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* Create pool */}
      <form
        onSubmit={submit}
        className="lg:col-span-2 h-fit rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5"
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Droplets className="h-4 w-4 text-[var(--accent)]" />
          Create pool
        </h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          List a pool that exists on-chain. Seed real liquidity on PumpkinSwap
          first, then record it here. TVL & APR are computed live from on-chain
          reserves and 24h volume — no need to enter them.
        </p>

        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Token A">
              <select
                value={token0}
                onChange={(e) => setToken0(e.target.value)}
                className={INPUT}
              >
                {symbols.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Token B">
              <select
                value={token1}
                onChange={(e) => setToken1(e.target.value)}
                className={INPUT}
              >
                {symbols.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Fee % (PumpkinSwap V2 = 0.3)">
            <input
              type="number"
              value={feeTier}
              onChange={(e) => setFeeTier(e.target.value)}
              className={INPUT}
            />
          </Field>
        </div>

        <button
          type="submit"
          className="mt-5 w-full rounded-2xl bg-[var(--accent)] py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
        >
          Create pool
        </button>
      </form>

      {/* Pool list */}
      <div className="lg:col-span-3">
        <h2 className="mb-3 text-sm font-semibold">Pools ({pools.length})</h2>
        <div className="space-y-2">
          {pools.length === 0 && (
            <div className="rounded-3xl border border-dashed border-[var(--border-strong)] py-12 text-center text-sm text-[var(--muted)]">
              No pools — create one on the left.
            </div>
          )}
          {pools.map((p) => {
            const visible = !(hiddenPools ?? []).includes(p.id);
            return (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <TokenPair token0={p.token0} token1={p.token1} />
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {p.token0} / {p.token1}
                    {!visible && (
                      <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">
                        Hidden
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    {p.feeTier}% fee ·{" "}
                    {stats[p.id]?.loading
                      ? "…"
                      : stats[p.id]?.available
                        ? `${formatUsd(stats[p.id].tvlUsd, { compact: true })} TVL · ${stats[p.id].apr.toLocaleString(undefined, { maximumFractionDigits: 2 })}% APR`
                        : "no on-chain liquidity"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setPoolVisible(p.id, !visible);
                    toast.info(
                      visible
                        ? `${p.token0}/${p.token1} pool hidden — existing LPs can still withdraw`
                        : `${p.token0}/${p.token1} pool is now visible`,
                    );
                  }}
                  title={visible ? "Hide from frontend" : "Show on frontend"}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface)] ${
                    visible ? "text-[var(--up)]" : "text-[var(--muted-2)]"
                  }`}
                >
                  <Power className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setDeleteTarget(p)}
                  title="Remove pool"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--down)] transition-colors hover:bg-[var(--down-soft)]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            );
          })}
        </div>
      </div>

      <DeleteConfirmModal
        open={deleteTarget !== null}
        title={`${deleteTarget?.token0 ?? ""}/${deleteTarget?.token1 ?? ""} Delete Pool`}
        description={
          // Deleting only drops the site listing — the on-chain pair and
          // users' LP tokens are untouched, but holders lose this site's
          // withdraw UI. Warn extra when the pool has liquidity.
          (deleteTarget &&
          stats[deleteTarget.id]?.available &&
          stats[deleteTarget.id].tvlUsd > 0
            ? `⚠️ This pool has on-chain liquidity (${formatUsd(stats[deleteTarget.id].tvlUsd, { compact: true })}). Deleting it keeps on-chain funds intact but LP holders will lose the withdraw UI on this site — consider hiding it (power button) instead.\n\n`
            : "") +
          "Removes this pool from the site listing. The on-chain pair and LP tokens are unaffected."
        }
        onConfirm={() => {
          if (!deleteTarget) return;
          removePool(deleteTarget.id);
          toast.info(`Removed ${deleteTarget.token0}/${deleteTarget.token1} pool`);
          setDeleteTarget(null);
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

/** Admin control of which tokens are swappable + adding custom tokens. */
function SwapTokensManager() {
  const { all } = useTokenRegistry();
  const adminTokens = useDexStore((s) => s.adminTokens);
  const disabledTokens = useDexStore((s) => s.disabledTokens);
  const removedTokens = useDexStore((s) => s.removedTokens);
  const addAdminToken = useDexStore((s) => s.addAdminToken);
  const removeAdminToken = useDexStore((s) => s.removeAdminToken);
  const setTokenEnabled = useDexStore((s) => s.setTokenEnabled);
  const removeToken = useDexStore((s) => s.removeToken);
  const restoreToken = useDexStore((s) => s.restoreToken);

  const [address, setAddress] = useState("");
  // Delete goes through the password-gated confirm modal.
  const [deleteTarget, setDeleteTarget] = useState<{
    symbol: string;
    custom: boolean;
  } | null>(null);
  // Manual edits, scoped to the address they were typed for, so switching
  // addresses re-shows that token's auto-detected values (no effect needed).
  const [edits, setEdits] = useState<{
    addr: string;
    symbol?: string;
    name?: string;
    decimals?: string;
  }>({ addr: "" });

  const adminSymbols = new Set(adminTokens.map((t) => t.symbol));

  // Auto-detect: read symbol/name/decimals straight from the contract so the
  // admin only pastes an address. Values are derived (not stored) — manual
  // edits override the detected ones until the address changes.
  const addrTrim = address.trim();
  const addrKey = addrTrim.toLowerCase();
  const validAddr = /^0x[a-fA-F0-9]{40}$/.test(addrTrim);

  const { data: tokenInfo, isLoading: infoLoading } = useReadContracts({
    contracts: validAddr
      ? ([
          { address: addrTrim as `0x${string}`, abi: erc20Abi, functionName: "symbol", chainId: CHAIN_ID },
          { address: addrTrim as `0x${string}`, abi: erc20Abi, functionName: "name", chainId: CHAIN_ID },
          { address: addrTrim as `0x${string}`, abi: erc20Abi, functionName: "decimals", chainId: CHAIN_ID },
        ] as const)
      : [],
    query: { enabled: validAddr },
  });

  const auto = {
    symbol:
      tokenInfo?.[0]?.status === "success" ? String(tokenInfo[0].result) : undefined,
    name:
      tokenInfo?.[1]?.status === "success" ? String(tokenInfo[1].result) : undefined,
    decimals:
      tokenInfo?.[2]?.status === "success" ? String(tokenInfo[2].result) : undefined,
  };

  const detectFailed =
    validAddr && !infoLoading && tokenInfo?.[0]?.status === "failure";

  // Effective (displayed) values: this-address edits → auto-detected → default.
  const ov: { symbol?: string; name?: string; decimals?: string } =
    edits.addr === addrKey ? edits : {};
  const symbol = ov.symbol ?? auto.symbol ?? "";
  const name = ov.name ?? auto.name ?? "";
  const decimals = ov.decimals ?? auto.decimals ?? "18";

  const setEdit = (patch: Partial<typeof edits>) =>
    setEdits((e) => ({ addr: addrKey, ...(e.addr === addrKey ? e : {}), ...patch }));
  const setSymbol = (v: string) => setEdit({ symbol: v });
  const setDecimals = (v: string) => setEdit({ decimals: v });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const sym = symbol.trim().toUpperCase();
    const addr = address.trim();
    const dec = parseInt(decimals, 10);
    if (!sym) return toast.error("Enter a token symbol");
    if (all.some((t) => t.symbol === sym))
      return toast.error(`${sym} already exists`);
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr))
      return toast.error("Invalid Xphere contract address");
    if (!Number.isInteger(dec) || dec < 0 || dec > 36)
      return toast.error("Decimals must be 0–36");

    addAdminToken({
      symbol: sym,
      name: name.trim() || sym,
      address: addr,
      decimals: dec,
      color: "#6366f1",
    });
    toast.success(`Added ${sym} to the swap list`);
    setAddress("");
    setEdits({ addr: "" });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* Add custom token */}
      <form
        onSubmit={submit}
        className="lg:col-span-2 h-fit rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5"
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Coins className="h-4 w-4 text-[var(--accent)]" />
          Add swap token
        </h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Paste a contract address — symbol, name and decimals are read straight
          from the token (editable). On testnet, use your deployed test-token
          address.
        </p>

        <div className="mt-4 space-y-3">
          <Field label="Contract address">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x… paste to auto-fill"
              className={`${INPUT} font-mono`}
            />
          </Field>
          {validAddr && (
            <p className="-mt-1 text-xs">
              {infoLoading ? (
                <span className="text-[var(--muted)]">
                  Loading token info…
                </span>
              ) : detectFailed ? (
                <span className="text-[var(--down)]">
                  Could not read on-chain data — enter details manually below.
                </span>
              ) : (
                <span className="text-[var(--up)]">
                  ✓ Auto-filled from on-chain (editable)
                </span>
              )}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Symbol">
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="USDT"
                className={INPUT}
              />
            </Field>
            <Field label="Decimals">
              <input
                type="number"
                value={decimals}
                onChange={(e) => setDecimals(e.target.value)}
                className={INPUT}
              />
            </Field>
          </div>
          {/* Name is auto-read from the contract (shown in the token picker /
              portfolio); falls back to the symbol — no manual input needed. */}
        </div>

        <button
          type="submit"
          className="mt-5 w-full rounded-2xl bg-[var(--accent)] py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
        >
          Add token
        </button>
      </form>

      {/* Token list with enable/disable */}
      <div className="lg:col-span-3">
        <h2 className="mb-3 text-sm font-semibold">
          Swap tokens ({all.filter((t) => !disabledTokens.includes(t.symbol)).length}{" "}
          enabled)
        </h2>
        <div className="space-y-2">
          {all.map((t) => {
            const enabled = !disabledTokens.includes(t.symbol);
            const custom = adminSymbols.has(t.symbol);
            return (
              <div
                key={t.symbol}
                className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <TokenLogo symbol={t.symbol} size={34} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{t.symbol}</span>
                      {custom && (
                        <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
                          Custom
                        </span>
                      )}
                      {!tokenTradable(t) && (
                        <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">
                          No contract
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-xs text-[var(--muted)]">
                      {t.address ? shortAddress(t.address) : "native"}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setTokenEnabled(t.symbol, !enabled)}
                    title={enabled ? "Disable for swapping" : "Enable for swapping"}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface)] ${
                      enabled ? "text-[var(--up)]" : "text-[var(--muted-2)]"
                    }`}
                  >
                    <Power className="h-4 w-4" />
                  </button>
                  {/* XP stays: it is the gas token and the routing hop. */}
                  {t.symbol !== "XP" && (
                    <button
                      onClick={() => setDeleteTarget({ symbol: t.symbol, custom })}
                      title={custom ? "Remove custom token" : "Delist (remove from list)"}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--down)] transition-colors hover:bg-[var(--down-soft)]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Delisted static tokens — restorable (custom tokens delete outright). */}
        {(removedTokens ?? []).length > 0 && (
          <div className="mt-4 rounded-2xl border border-dashed border-[var(--border-strong)] px-4 py-3">
            <p className="text-xs font-medium text-[var(--muted)]">
              Delisted tokens
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {removedTokens.map((sym) => (
                <button
                  key={sym}
                  onClick={() => {
                    restoreToken(sym);
                    toast.success(`${sym} restored`);
                  }}
                  title="Restore"
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border-strong)] px-3 py-1 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
                >
                  <Plus className="h-3 w-3" />
                  {sym}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <DeleteConfirmModal
        open={deleteTarget !== null}
        title={`${deleteTarget?.symbol ?? ""} ${deleteTarget?.custom ? "Delete" : "Delist"}`}
        description={
          deleteTarget?.custom
            ? `Permanently delete custom token ${deleteTarget.symbol}. You will need to re-register it by contract address to use it again.`
            : `${deleteTarget?.symbol} will be delisted — it will disappear from the swap list and home price ticker. You can restore it under 'Delisted tokens'.`
        }
        confirmLabel={deleteTarget?.custom ? "Delete" : "Delist"}
        onConfirm={() => {
          if (!deleteTarget) return;
          if (deleteTarget.custom) removeAdminToken(deleteTarget.symbol);
          else removeToken(deleteTarget.symbol);
          toast.info(
            deleteTarget.custom
              ? `Removed ${deleteTarget.symbol}`
              : `${deleteTarget.symbol} delisted — restorable below`,
          );
          setDeleteTarget(null);
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

interface AnalyticsSummary {
  day: string;
  visitors: number;
  visitorsTotal: number;
  connections: number;
  volumeUsd: number;
}

function AnalyticsPanel() {
  const { data } = useQuery<AnalyticsSummary>({
    queryKey: ["admin-analytics"],
    queryFn: async () => {
      const res = await fetch("/api/analytics");
      if (!res.ok) throw new Error("analytics fetch failed");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const num = (n: number | undefined) =>
    n === undefined ? "—" : n.toLocaleString();

  const detailBtn = (href: string) => (
    <button
      onClick={() => window.open(href, "_blank", "noopener,noreferrer")}
      className="inline-flex items-center gap-1 rounded-full border border-[var(--border-strong)] px-2.5 py-1 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
    >
      <ListFilter className="h-3 w-3" />
      Detail
    </button>
  );

  const cards = [
    {
      label: "Visitors (today)",
      value: num(data?.visitors),
      sub:
        data === undefined
          ? undefined
          : `${data.visitorsTotal.toLocaleString()} total cumulative`,
      icon: <Users className="h-4 w-4" />,
      action: detailBtn("/api/analytics/visitors"),
    },
    {
      label: "Wallet Connections (total)",
      value: num(data?.connections),
      sub: undefined as string | undefined,
      icon: <Wallet className="h-4 w-4" />,
      action: detailBtn("/api/analytics/connections"),
    },
    {
      label: "Volume (today)",
      value:
        data === undefined
          ? "—"
          : formatUsd(data.volumeUsd, { compact: true }),
      sub: undefined as string | undefined,
      icon: <TrendingUp className="h-4 w-4" />,
      action: null as React.ReactNode,
    },
  ];

  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          Visitors & volume are today (KST) · wallet connections are total cumulative
        </h2>
        {data && (
          <span className="font-mono text-xs text-[var(--muted-2)]">
            {data.day}
          </span>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                <span className="text-[var(--accent)]">{c.icon}</span>
                {c.label}
              </div>
              {c.action}
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {c.value}
            </div>
            {c.sub && (
              <div className="mt-1 text-xs font-medium text-[var(--muted-2)]">
                {c.sub}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CampaignForm() {
  const createCampaign = useDexStore((s) => s.createCampaign);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("XP");
  const [amountPerClaim, setAmountPerClaim] = useState("100");
  const [totalAllocation, setTotalAllocation] = useState("100000");
  const [eligibility, setEligibility] = useState<Eligibility>("public");
  const [durationDays, setDurationDays] = useState("14");

  const reset = () => {
    setName("");
    setDescription("");
    setAmountPerClaim("100");
    setTotalAllocation("100000");
    setEligibility("public");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("Enter a campaign name");
    // Whitelist amounts are set per-wallet later, so reward/wallet is unused
    // here (defaults to 0); other eligibilities need a positive reward.
    const isWl = eligibility === "whitelist";
    const amt = isWl ? 0 : parseFloat(amountPerClaim);
    const total = parseFloat(totalAllocation);
    const days = parseFloat(durationDays);
    if (!isWl && (!Number.isFinite(amt) || amt <= 0 || amt > 1e12))
      return toast.error("Reward must be between 0 and 1e12");
    if (!Number.isFinite(total) || total < amt || total > 1e15)
      return toast.error(
        isWl ? "Allocation must be 0–1e15" : "Allocation must be ≥ reward and ≤ 1e15",
      );
    if (!Number.isFinite(days) || days <= 0 || days > 3650)
      return toast.error("Duration must be 1–3650 days");

    createCampaign({
      name: name.trim(),
      description:
        description.trim() || "Claim your reward from this campaign.",
      tokenSymbol,
      amountPerClaim: amt,
      totalAllocation: total,
      eligibility,
      whitelist: [],
      active: true,
      endsAt: Date.now() + days * DAY,
    });
    toast.success(`Created "${name.trim()}"`);
    reset();
  };

  return (
    <form
      onSubmit={submit}
      className="sticky top-20 rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5"
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Plus className="h-4 w-4 text-[var(--accent)]" />
        New campaign
      </h2>

      <div className="mt-4 space-y-3">
        <Field label="Campaign name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Summer Rewards"
            className={INPUT}
          />
        </Field>

        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Short description for users"
            className={`${INPUT} resize-none`}
          />
        </Field>

        <Field label="Reward token">
          <div className="grid grid-cols-2 gap-2">
            {[
              { sym: "XP", disabled: false },
              { sym: "KDG", disabled: false },
              { sym: "USDX", disabled: false },
              { sym: "IOI", disabled: true },
            ].map(({ sym, disabled }) => (
              <button
                key={sym}
                type="button"
                disabled={disabled}
                onClick={() => setTokenSymbol(sym)}
                title={disabled ? "Token contract not deployed — unavailable" : undefined}
                className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 text-sm font-medium transition-colors ${
                  tokenSymbol === sym
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--muted)]"
                } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
              >
                <TokenLogo symbol={sym} size={18} />
                {sym}
              </button>
            ))}
          </div>
        </Field>

        <div className={eligibility === "whitelist" ? "" : "grid grid-cols-2 gap-3"}>
          {/* Whitelist sets per-wallet amounts individually (see whitelist
              manager), so a single reward/wallet value isn't needed there. */}
          {eligibility !== "whitelist" && (
            <Field label="Reward / wallet">
              <input
                type="text"
                inputMode="decimal"
                value={formatAmountInput(amountPerClaim)}
                onChange={(e) => setAmountPerClaim(parseAmountInput(e.target.value))}
                className={INPUT}
              />
            </Field>
          )}
          <Field label="Total allocation">
            <input
              type="text"
              inputMode="decimal"
              value={formatAmountInput(totalAllocation)}
              onChange={(e) => setTotalAllocation(parseAmountInput(e.target.value))}
              className={INPUT}
            />
          </Field>
        </div>

        <Field label="Eligibility">
          <div className="grid grid-cols-2 gap-2">
            {(["public", "whitelist"] as Eligibility[]).map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEligibility(e)}
                className={`rounded-xl border py-2 text-xs font-medium capitalize transition-colors ${
                  eligibility === e
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--muted)]"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Duration (days)">
          <input
            type="number"
            value={durationDays}
            onChange={(e) => setDurationDays(e.target.value)}
            className={INPUT}
          />
        </Field>
      </div>

      <button
        type="submit"
        className="mt-5 w-full rounded-2xl bg-[var(--accent)] py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
      >
        Create campaign
      </button>
    </form>
  );
}

function CampaignAdminRow({ campaign: c }: { campaign: AirdropCampaign }) {
  const updateCampaign = useDexStore((s) => s.updateCampaign);
  const deleteCampaign = useDexStore((s) => s.deleteCampaign);
  const { address: wallet, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [txBusy, setTxBusy] = useState(false);
  // Delete/end goes through the password-gated confirm modal.
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Launched on-chain → pause/end must be real transactions, not local state.
  const launched = c.onchainId != null;

  // For launched campaigns the chain's `active` flag is what actually gates
  // claims — drive the badge and the Power toggle from it, not from the
  // persisted local copy (which goes stale when a receipt wait times out or
  // the campaign is paused from another browser).
  const { data: onchainRow, refetch: refetchOnchain } = useReadContract({
    address: launched && airdropLive ? (AIRDROP_CONTRACT as `0x${string}`) : undefined,
    abi: AIRDROP_ABI,
    functionName: "campaigns",
    args: launched ? [BigInt(c.onchainId!)] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: launched && airdropLive, refetchInterval: 30_000 },
  });
  const onchainActive =
    onchainRow !== undefined
      ? (onchainRow as readonly [string, string, bigint, bigint, bigint, bigint, boolean])[6]
      : undefined;
  // A zero token in the row means this id doesn't exist on the CURRENT
  // contract — the record was launched on a previous deployment (env
  // cutover). On-chain actions can't touch it; delete goes local-only.
  const missingOnchain =
    launched &&
    onchainRow !== undefined &&
    /^0x0+$/.test(
      (onchainRow as readonly [string, ...unknown[]])[0] as string,
    );
  const isActive = launched ? (onchainActive ?? c.active) : c.active;

  // Per-wallet claim state straight from the chain (launched whitelist
  // campaigns) — pills/counters update automatically as wallets claim.
  const wlStatus = useWhitelistClaimStatus(c);

  const requireWallet = (): boolean => {
    if (!wallet || !publicClient) {
      toast.error("Connect your wallet");
      return false;
    }
    if (chainId !== CHAIN_ID) {
      toast.error("Switch your wallet network to Xphere");
      return false;
    }
    return true;
  };

  const togglePause = async () => {
    if (!launched) return updateCampaign(c.id, { active: !c.active });
    if (missingOnchain)
      return toast.error(
        "This campaign was launched on a previous contract — it cannot be controlled from the current contract",
      );
    if (!requireWallet()) return;
    if (!(await ensureContractOwner(publicClient!, wallet!))) return;
    const next = !isActive;
    try {
      setTxBusy(true);
      toast.info(
        next
          ? "Resuming on-chain campaign… confirm in your wallet"
          : "Pausing on-chain campaign… confirm in your wallet",
      );
      const hash = await writeContractAsync({
        address: AIRDROP_CONTRACT as `0x${string}`,
        abi: AIRDROP_ABI,
        functionName: "setActive",
        args: [BigInt(c.onchainId!), next],
        chainId: CHAIN_ID,
      });
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        return toast.error("On-chain transaction failed");
      updateCampaign(c.id, { active: next });
      toast.success(next ? "Campaign resumed (on-chain)" : "Campaign paused (on-chain)");
    } catch {
      // The tx may still have landed (receipt wait can time out on testnet
      // RPC) — the on-chain read below self-corrects the badge either way.
      toast.error("Status check failed — badge will sync to chain state shortly");
    } finally {
      // Whatever happened, resync the badge with the chain.
      void refetchOnchain();
      setTxBusy(false);
    }
  };

  const removeCampaign = async () => {
    // Local-only draft, or a record launched on a PREVIOUS contract (its id
    // doesn't exist on the current one) → plain local delete.
    if (!launched || missingOnchain) {
      deleteCampaign(c.id);
      toast.info(
        `Deleted "${c.name}"` +
          (missingOnchain ? " — launched on previous contract, only local record deleted" : ""),
      );
      return;
    }
    if (!requireWallet()) return;
    if (!(await ensureContractOwner(publicClient!, wallet!))) return;
    try {
      setTxBusy(true);
      toast.info("Submitting end & sweep transaction… confirm in your wallet");
      const hash = await writeContractAsync({
        address: AIRDROP_CONTRACT as `0x${string}`,
        abi: AIRDROP_ABI,
        functionName: "endAndSweep",
        args: [BigInt(c.onchainId!), wallet!],
        chainId: CHAIN_ID,
      });
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        return toast.error("On-chain transaction failed");
      updateCampaign(c.id, { active: false, endsAt: Date.now() });
      toast.success("Campaign ended — unclaimed tokens swept to your wallet");
    } catch {
      toast.error("End & sweep failed — verify you are connected as the contract owner");
    } finally {
      setTxBusy(false);
    }
  };

  // Whitelist campaigns track claims per-wallet; others use the flat counter.
  // Launched campaigns derive everything from the chain; drafts fall back to
  // the local hand-toggled flags.
  const isWl = c.eligibility === "whitelist";
  const receivedRows = c.whitelist.map((w) => ({
    address: w.address,
    allocated: w.amount,
    received:
      launched && wlStatus.loaded
        ? (wlStatus.received[w.address.toLowerCase()] ?? 0)
        : w.claimed
          ? w.amount
          : 0,
  }));
  let claimsCount: number;
  let claimedAlloc: number;
  if (isWl) {
    claimsCount = receivedRows.filter((r) => r.received > 0).length;
    claimedAlloc = receivedRows.reduce((sum, r) => sum + r.received, 0);
  } else if (launched && onchainRow) {
    // Public launched: claimed total / per-claim straight from the chain row.
    const row = onchainRow as readonly [
      string,
      string,
      bigint,
      bigint,
      bigint,
      bigint,
      boolean,
    ];
    const dec = TOKEN_MAP[c.tokenSymbol]?.decimals ?? 18;
    claimedAlloc = Number(formatUnits(row[3], dec));
    claimsCount = row[4] > 0n ? Number(row[3] / row[4]) : c.claimedCount;
  } else {
    claimsCount = c.claimedCount;
    claimedAlloc = c.claimedCount * c.amountPerClaim;
  }

  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <TokenLogo symbol={c.tokenSymbol} size={40} />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{c.name}</h3>
              {isActive ? (
                <span className="rounded-full bg-[var(--up-soft)] px-2 py-0.5 text-xs font-medium text-[var(--up)]">
                  Active
                </span>
              ) : (
                <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">
                  Paused
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--muted)] capitalize">
              {c.eligibility} ·{" "}
              {isWl
                ? `${c.tokenSymbol} (per-wallet amounts)`
                : `${c.amountPerClaim} ${c.tokenSymbol} / wallet`}{" "}
              · {daysUntil(c.endsAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => openClaimDetail(c, isWl ? receivedRows : undefined)}
            title="View claim history"
            className="inline-flex items-center gap-1 rounded-full border border-[var(--border-strong)] px-2.5 py-1 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
          >
            <ListFilter className="h-3 w-3" />
            Detail
          </button>
          <button
            onClick={togglePause}
            disabled={txBusy}
            title={
              launched
                ? isActive
                  ? "Pause on-chain"
                  : "Resume on-chain"
                : isActive
                  ? "Pause"
                  : "Activate"
            }
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {txBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Power className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={txBusy}
            title={launched ? "End immediately + sweep unclaimed" : "Delete"}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--down)] transition-colors hover:bg-[var(--down-soft)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3 border-t border-[var(--border)] pt-3 text-center">
        <Mini
          label={isWl ? "Received" : "Claims"}
          value={isWl ? `${claimsCount}/${c.whitelist.length}` : String(claimsCount)}
        />
        <Mini
          label="Distributed"
          value={`${claimedAlloc.toLocaleString()} ${c.tokenSymbol}`}
        />
        <Mini
          label="Allocation"
          value={`${c.totalAllocation.toLocaleString()} ${c.tokenSymbol}`}
        />
      </div>

      {c.eligibility === "whitelist" && (
        <WhitelistManager
          campaign={c}
          claimStatus={wlStatus}
          missingOnchain={missingOnchain}
        />
      )}
      {c.eligibility === "public" && <PublicLaunchPanel campaign={c} />}

      <DeleteConfirmModal
        open={confirmDelete}
        title={
          launched && !missingOnchain
            ? `End Campaign #${c.onchainId} Now`
            : `Delete "${c.name}"`
        }
        description={
          launched && !missingOnchain
            ? `Immediately ends on-chain campaign #${c.onchainId}. Claims stop at once and all unclaimed tokens are swept to the connected owner wallet. This cannot be undone.`
            : missingOnchain
              ? `"${c.name}" was launched on a previous contract — it does not exist on the current contract, so only the local record will be deleted. Unclaimed tokens on the old contract must be swept separately.`
              : `Delete the draft for campaign "${c.name}" (including its whitelist).`
        }
        confirmLabel={launched && !missingOnchain ? "End + Sweep" : "Delete"}
        onConfirm={() => {
          setConfirmDelete(false);
          void removeCampaign();
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}

/** Wall-clock check kept outside the component for the react-compiler purity lint. */
function isPastMs(ms: number): boolean {
  return ms !== 0 && ms <= Date.now();
}

/**
 * Owner pre-check for owner-only contract actions (launch / pause / sweep /
 * updateRoot). The contract just reverts "not owner", so without this the
 * admin only sees a generic failure — here they get told WHICH wallet to
 * connect. RPC failure → optimistically true (the tx surfaces the real error).
 */
async function ensureContractOwner(
  publicClient: { readContract: (args: never) => Promise<unknown> },
  wallet: string,
): Promise<boolean> {
  try {
    const owner = (await publicClient.readContract({
      address: AIRDROP_CONTRACT as `0x${string}`,
      abi: AIRDROP_ABI,
      functionName: "owner",
    } as never)) as string;
    if (owner.toLowerCase() !== wallet.toLowerCase()) {
      toast.error(
        `Not the contract owner — connect with wallet ${shortAddress(owner)} (current: ${shortAddress(wallet)})`,
      );
      return false;
    }
  } catch {
    // owner() read failed — let the tx attempt report the real error
  }
  return true;
}

/**
 * Destructive-action gate: confirmation modal that re-verifies the admin
 * password server-side (/api/admin/verify) before running onConfirm.
 */
function DeleteConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [verifying, setVerifying] = useState(false);
  if (!open) return null;

  const cancel = () => {
    setPassword("");
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return toast.error("Enter the admin password");
    try {
      setVerifying(true);
      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.status === 429)
        return toast.error("Too many attempts — try again in 10 minutes");
      if (!res.ok) return toast.error("Incorrect password");
      setPassword("");
      onClose();
      onConfirm();
    } catch {
      toast.error("Verification request failed — check your network");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/50 p-4 pt-32">
      <div className="absolute inset-0" onClick={cancel} aria-hidden />
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-fade-in relative w-full max-w-sm rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Trash2 className="h-4 w-4 text-[var(--down)]" />
            {title}
          </h3>
          <button
            type="button"
            onClick={cancel}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--surface)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-3 whitespace-pre-line text-xs leading-relaxed text-[var(--muted)]">
          {description}
        </p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Admin password"
          autoFocus
          autoComplete="current-password"
          className={`${INPUT} mt-4`}
        />
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={cancel}
            className="flex-1 rounded-2xl border border-[var(--border-strong)] py-2.5 text-sm font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={verifying}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[var(--down)] py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {verifying && <Loader2 className="h-4 w-4 animate-spin" />}
            {verifying ? "Verifying…" : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

const ZERO_ROOT =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

/**
 * Resolve the on-chain token a campaign funds/pays out with. ERC-20 tokens
 * (KDG, USDX) use their contract; native XP (no contract) uses the NATIVE
 * sentinel — the contract funds it via msg.value and pays claimers native XP
 * directly (no wrapping). `native` drives the funding path. Returns null when
 * no usable on-chain token exists.
 */
function resolveOnchainReward(
  symbol: string,
): { token: `0x${string}`; decimals: number; native: boolean } | null {
  const t = TOKEN_MAP[symbol];
  if (!t) return null;
  if (t.address)
    return { token: t.address as `0x${string}`, decimals: t.decimals, native: false };
  if (t.symbol === NATIVE_SYMBOL)
    return { token: NATIVE_TOKEN, decimals: t.decimals, native: true };
  return null;
}

/**
 * On-chain launch for a PUBLIC campaign: approve the airdrop contract for the
 * total allocation, then createCampaign with no Merkle root and a fixed
 * amountPerClaim. Once launched, any wallet can claim from the /airdrop page
 * (read straight from the chain — no whitelist, no per-user data sharing).
 * Must be run by the contract owner holding enough reward tokens.
 */
function PublicLaunchPanel({ campaign: c }: { campaign: AirdropCampaign }) {
  const updateCampaign = useDexStore((s) => s.updateCampaign);
  const { address: wallet, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [launching, setLaunching] = useState(false);

  const locked = c.onchainId != null;

  const launchPublic = async () => {
    if (!airdropLive)
      return toast.error("Airdrop contract is not yet deployed/configured");
    if (!wallet || !publicClient) return toast.error("Connect your wallet");
    if (chainId !== CHAIN_ID)
      return toast.error("Switch your wallet network to Xphere");
    const reward = resolveOnchainReward(c.tokenSymbol);
    if (!reward)
      return toast.error(`No token contract configured for ${c.tokenSymbol} on-chain launch`);
    if (!(c.amountPerClaim > 0))
      return toast.error("Amount per claim (amountPerClaim) must be greater than 0");
    if (c.amountPerClaim > c.totalAllocation)
      return toast.error("Amount per claim cannot exceed total allocation");
    if (!(await ensureContractOwner(publicClient, wallet))) return;

    try {
      setLaunching(true);
      const { token: tokenAddr, decimals, native } = reward;
      const totalWei = parseUnits(String(c.totalAllocation), decimals);
      const perClaimWei = parseUnits(String(c.amountPerClaim), decimals);
      const endsAtSec = BigInt(Math.floor(c.endsAt / 1000));
      const contract = AIRDROP_CONTRACT as `0x${string}`;
      const steps = native ? 1 : 2;
      let step = 0;

      // ERC-20 campaigns approve the contract first; native XP is funded
      // directly via msg.value on createCampaign (claimers get native XP).
      if (!native) {
        toast.info(`${++step}/${steps} Approving token spend… confirm in your wallet`);
        const approveHash = await writeContractAsync({
          address: tokenAddr,
          abi: erc20Abi,
          functionName: "approve",
          args: [contract, totalWei],
          chainId: CHAIN_ID,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      toast.info(`${++step}/${steps} Creating & funding campaign… confirm in your wallet`);
      const createHash = await writeContractAsync({
        address: contract,
        abi: AIRDROP_ABI,
        functionName: "createCampaign",
        // Public campaign: zero root + fixed amountPerClaim. Anyone claims once.
        args: [tokenAddr, ZERO_ROOT, totalWei, endsAtSec, perClaimWei, c.name],
        value: native ? totalWei : 0n,
        chainId: CHAIN_ID,
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: createHash,
      });
      if (receipt.status !== "success")
        return toast.error("On-chain create transaction failed");

      const logs = parseEventLogs({
        abi: AIRDROP_ABI,
        eventName: "CampaignCreated",
        logs: receipt.logs,
      });
      const id = logs.length ? Number(logs[0].args.id) : undefined;
      if (id === undefined)
        return toast.error("Could not read campaign ID (manual verification required)");

      updateCampaign(c.id, { onchainId: id });
      toast.success(`On-chain public campaign #${id} launched & funded — claims are now open`);
    } catch {
      toast.error(
        "Launch failed — check wallet rejection / insufficient balance / not owner",
      );
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="mt-4 rounded-2xl bg-[var(--surface)] p-4">
      {locked ? (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--up)]/30 bg-[var(--up-soft)] px-3 py-2 text-xs font-medium text-[var(--up)]">
          <Check className="h-4 w-4" />
          On-chain launched · Campaign #{c.onchainId} — anyone can claim {c.amountPerClaim.toLocaleString()}{" "}
          {c.tokenSymbol}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2">
          <span className="text-xs text-[var(--muted)]">
            {airdropLive
              ? `Ready to launch on-chain — funds ${c.amountPerClaim.toLocaleString()} ${c.tokenSymbol} × (total ${c.totalAllocation.toLocaleString()}) into the contract and opens claims to everyone.`
              : "Deploy the airdrop contract first before launching on-chain (npm run deploy:airdrop)."}
          </span>
          <button
            onClick={launchPublic}
            disabled={!airdropLive || launching}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {launching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Rocket className="h-3.5 w-3.5" />
            )}
            {launching ? "Launching…" : "Launch On-chain"}
          </button>
        </div>
      )}
    </div>
  );
}

interface ParsedRow {
  line: number;
  raw: string;
  address?: string;
  amount?: number;
  error?: string;
}

/**
 * Parse the bulk box: one allocation per line — "0xaddr, amount" (comma, space
 * or tab separated). A line with only an address uses `defaultAmount`.
 */
function parseBulk(text: string, defaultAmount: number): ParsedRow[] {
  return text
    .split("\n")
    .map((raw, i) => ({ raw, line: i + 1 }))
    .filter((r) => r.raw.trim() !== "")
    .map(({ raw, line }): ParsedRow => {
      const parts = raw.trim().split(/[\s,]+/).filter(Boolean);
      const [addr, amtStr] = parts;
      if (!/^0x[a-fA-F0-9]{40}$/.test(addr ?? ""))
        return { line, raw, error: "invalid address" };
      const amount = amtStr !== undefined ? parseFloat(amtStr) : defaultAmount;
      if (!Number.isFinite(amount) || amount <= 0)
        return { line, raw, error: "invalid amount" };
      return { line, raw, address: addr.toLowerCase(), amount };
    });
}

function WhitelistManager({
  campaign: c,
  claimStatus,
  missingOnchain = false,
}: {
  campaign: AirdropCampaign;
  claimStatus: WlClaimStatus;
  /** Launched on a previous contract — its id isn't on the current one. */
  missingOnchain?: boolean;
}) {
  const address = useDexStore((s) => s.address);
  const addManyToWhitelist = useDexStore((s) => s.addManyToWhitelist);
  const removeFromWhitelist = useDexStore((s) => s.removeFromWhitelist);
  const setWhitelistClaimed = useDexStore((s) => s.setWhitelistClaimed);
  const updateCampaign = useDexStore((s) => s.updateCampaign);
  const { address: wallet, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [launching, setLaunching] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [bulk, setBulk] = useState("");
  const [defaultAmount, setDefaultAmount] = useState(
    c.amountPerClaim ? String(c.amountPerClaim) : "",
  );

  // Launched on-chain. The root is replaceable via updateRoot, so the
  // whitelist keeps growing — local additions go live with "On-chain Sync".
  const launched = c.onchainId != null;

  const parsed = parseBulk(bulk, parseFloat(defaultAmount));
  const valid = parsed.filter((r) => r.address && r.amount !== undefined);
  const invalid = parsed.filter((r) => r.error);

  const apply = () => {
    if (valid.length === 0)
      return toast.error("No valid rows to apply");
    // v4 contracts can never pay a top-up to a wallet that already claimed
    // (hasClaimed is permanent) — surface that before the admin funds it.
    if (launched && !claimStatus.supportsPartial) {
      const dup = valid.filter(
        (r) => (claimStatus.received[r.address!] ?? 0) > 0,
      );
      if (dup.length > 0)
        toast.error(
          `${dup.length} wallet(s) already claimed — top-ups cannot be re-claimed on the current contract (v4)`,
        );
    }
    addManyToWhitelist(
      c.id,
      valid.map((r) => ({ address: r.address!, amount: r.amount! })),
    );
    toast.success(
      `Applied ${valid.length} allocation${valid.length !== 1 ? "s" : ""}` +
        (invalid.length ? ` · skipped ${invalid.length} invalid` : "") +
        (launched ? ' — press "On-chain Sync" to make claims available' : ""),
    );
    setBulk("");
  };

  /**
   * Push the grown whitelist on-chain for an already-launched campaign:
   * rebuild the full Merkle root, top up funding for the added allocations
   * (updateRoot pulls the delta in), then republish the full list so any
   * visitor can rebuild their proof (the latest publish wins on read).
   */
  const syncOnChain = async () => {
    if (!wallet || !publicClient) return toast.error("Connect your wallet");
    if (chainId !== CHAIN_ID)
      return toast.error("Switch your wallet network to Xphere");
    const reward = resolveOnchainReward(c.tokenSymbol);
    if (!reward)
      return toast.error(`No token contract configured for ${c.tokenSymbol} on-chain launch`);
    if (missingOnchain)
      return toast.error(
        "This campaign was launched on a previous contract — delete it and launch a new campaign",
      );
    if (c.whitelist.length === 0)
      return toast.error("Whitelist is empty");
    if (!(await ensureContractOwner(publicClient, wallet))) return;
    // Block funding top-ups that v4 can never pay out: a claimed wallet's
    // grown allocation is unreachable behind the permanent hasClaimed flag,
    // so the delta would sit stranded in the contract until sweep.
    if (!claimStatus.supportsPartial) {
      const stranded = c.whitelist.filter((w) => {
        const got = claimStatus.received[w.address.toLowerCase()] ?? 0;
        return got > 0 && w.amount > got;
      });
      if (stranded.length > 0)
        return toast.error(
          `${stranded.length} wallet(s) already claimed have increased allocations — v4 contract cannot re-claim, redeploy v5 then sync`,
        );
    }
    try {
      setSyncing(true);
      const { token: rewardAddr, decimals, native } = reward;
      const allocs = c.whitelist.map((w) => ({
        address: w.address,
        amountWei: parseUnits(String(w.amount), decimals).toString(),
      }));
      const root = merkleRoot(allocs);
      // Keep funding topped up to the full allocation budget (not just the
      // whitelist sum) — lets an admin raise an under-funded campaign (e.g.
      // one launched before this change) to its allocation via "On-chain Sync".
      const wlSumWei = allocs.reduce((s, a) => s + BigInt(a.amountWei), 0n);
      const allocWei = parseUnits(String(c.totalAllocation), decimals);
      const totalWei = allocWei > wlSumWei ? allocWei : wlSumWei;
      const contract = AIRDROP_CONTRACT as `0x${string}`;
      const id = BigInt(c.onchainId!);

      // Top-up = new cumulative total − what's already funded on-chain.
      const onchain = (await publicClient.readContract({
        address: contract,
        abi: AIRDROP_ABI,
        functionName: "campaigns",
        args: [id],
      })) as readonly [
        string,
        string,
        bigint,
        bigint,
        bigint,
        bigint,
        boolean,
      ];
      const fundedWei = onchain[2];
      const endsAtSec = Number(onchain[5]);
      const isActive = onchain[6];
      // Guard: topping up an inactive/ended campaign locks tokens that
      // claim() will always reject — block and route the admin instead.
      if (!isActive) {
        return toast.error(
          "Campaign is paused — resume it (Power) before syncing",
        );
      }
      if (isPastMs(endsAtSec * 1000)) {
        return toast.error(
          "Campaign has ended — sweep unclaimed tokens then launch a new campaign",
        );
      }
      const delta = totalWei > fundedWei ? totalWei - fundedWei : 0n;
      const steps = !native && delta > 0n ? 3 : 2;
      let step = 0;

      // ERC-20 top-ups approve the delta first; native XP top-ups fund the
      // delta directly via msg.value on updateRoot (no approve, no wrapping).
      if (delta > 0n && !native) {
        toast.info(`${++step}/${steps} Approving top-up… confirm in your wallet`);
        const approveHash = await writeContractAsync({
          address: rewardAddr,
          abi: erc20Abi,
          functionName: "approve",
          args: [contract, delta],
          chainId: CHAIN_ID,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      toast.info(
        `${++step}/${steps} Updating${delta > 0n ? " & funding" : ""} Merkle root… confirm in your wallet`,
      );
      const updateHash = await writeContractAsync({
        address: contract,
        abi: AIRDROP_ABI,
        functionName: "updateRoot",
        args: [id, root, delta],
        value: native ? delta : 0n,
        chainId: CHAIN_ID,
      });
      const updReceipt = await publicClient.waitForTransactionReceipt({
        hash: updateHash,
      });
      if (updReceipt.status !== "success")
        return toast.error("Root update transaction failed");

      toast.info(`${++step}/${steps} Re-publishing whitelist… confirm in your wallet`);
      const publishHash = await writeContractAsync({
        address: contract,
        abi: AIRDROP_ABI,
        functionName: "publishWhitelist",
        args: [
          id,
          allocs.map((a) => a.address as `0x${string}`),
          allocs.map((a) => BigInt(a.amountWei)),
        ],
        chainId: CHAIN_ID,
      });
      const pubReceipt = await publicClient.waitForTransactionReceipt({
        hash: publishHash,
      });
      if (pubReceipt.status !== "success")
        return toast.error(
          "Whitelist re-publish failed — press 'On-chain Sync' again to retry",
        );

      toast.success(
        `Campaign #${c.onchainId} whitelist synced — new wallets can now claim`,
      );
    } catch {
      toast.error("On-chain sync failed — check owner wallet / token balance");
    } finally {
      setSyncing(false);
    }
  };

  const addMyWallet = () => {
    if (!address) return;
    setBulk((b) => (b.trim() ? `${b.replace(/\n*$/, "")}\n${address}` : address));
  };

  const totalAllocated = c.whitelist.reduce((sum, w) => sum + w.amount, 0);

  /**
   * Build the Merkle root from the whitelist, approve the airdrop contract for
   * the total, and createCampaign (funds it). Saves the on-chain id so users
   * can claim. Must be run by the contract owner with enough reward tokens.
   */
  const launchOnChain = async () => {
    if (!airdropLive)
      return toast.error("Airdrop contract is not yet deployed/configured");
    if (!wallet || !publicClient) return toast.error("Connect your wallet");
    if (chainId !== CHAIN_ID)
      return toast.error("Switch your wallet network to Xphere");
    const reward = resolveOnchainReward(c.tokenSymbol);
    if (!reward)
      return toast.error(`No token contract configured for ${c.tokenSymbol} on-chain launch`);
    if (c.whitelist.length === 0)
      return toast.error("Whitelist is empty");
    if (!(await ensureContractOwner(publicClient, wallet))) return;

    try {
      setLaunching(true);
      const { token: tokenAddr, decimals, native } = reward;
      const allocs = c.whitelist.map((w) => ({
        address: w.address,
        amountWei: parseUnits(String(w.amount), decimals).toString(),
      }));
      const root = merkleRoot(allocs);
      // Fund the FULL allocation budget (e.g. 1,000,000), not just the current
      // whitelist sum — so the progress bar reads claimed / total-allocation
      // for every visitor and fills as the admin grows the list and wallets
      // claim. Unclaimed remainder is recovered with endAndSweep at the end.
      const wlSumWei = c.whitelist.reduce(
        (s, w) => s + parseUnits(String(w.amount), decimals),
        0n,
      );
      const allocWei = parseUnits(String(c.totalAllocation), decimals);
      const totalWei = allocWei > wlSumWei ? allocWei : wlSumWei;
      const endsAtSec = BigInt(Math.floor(c.endsAt / 1000));
      const contract = AIRDROP_CONTRACT as `0x${string}`;

      const steps = native ? 2 : 3;
      let step = 0;

      // ERC-20 campaigns approve the contract first; native XP is funded
      // directly via msg.value on createCampaign (claimers get native XP).
      if (!native) {
        toast.info(`${++step}/${steps} Approving token spend… confirm in your wallet`);
        const approveHash = await writeContractAsync({
          address: tokenAddr,
          abi: erc20Abi,
          functionName: "approve",
          args: [contract, totalWei],
          chainId: CHAIN_ID,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      toast.info(`${++step}/${steps} Creating & funding campaign… confirm in your wallet`);
      const createHash = await writeContractAsync({
        address: contract,
        abi: AIRDROP_ABI,
        functionName: "createCampaign",
        // Whitelist campaign: amountPerClaim is unused on-chain (0); each wallet's
        // amount lives in the Merkle proof. Name is emitted for the claim page.
        args: [tokenAddr, root, totalWei, endsAtSec, 0n, c.name],
        value: native ? totalWei : 0n,
        chainId: CHAIN_ID,
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: createHash,
      });
      if (receipt.status !== "success")
        return toast.error("On-chain create transaction failed");

      const logs = parseEventLogs({
        abi: AIRDROP_ABI,
        eventName: "CampaignCreated",
        logs: receipt.logs,
      });
      const id = logs.length ? Number(logs[0].args.id) : undefined;
      if (id === undefined)
        return toast.error("Could not read campaign ID (manual verification required)");

      // Publish the allocation list on-chain (event-only) so any visitor can
      // rebuild their proof and claim — solves the whitelist data-sharing gap.
      toast.info(`${++step}/${steps} Publishing whitelist… confirm in your wallet`);
      const publishHash = await writeContractAsync({
        address: contract,
        abi: AIRDROP_ABI,
        functionName: "publishWhitelist",
        args: [
          BigInt(id),
          allocs.map((a) => a.address as `0x${string}`),
          allocs.map((a) => BigInt(a.amountWei)),
        ],
        chainId: CHAIN_ID,
      });
      const pubReceipt = await publicClient.waitForTransactionReceipt({
        hash: publishHash,
      });

      // The campaign IS launched+funded at this point regardless of the
      // publish outcome — record it, and if the publish reverted point the
      // admin at On-chain Sync, which republishes the full list (the retry path).
      updateCampaign(c.id, { onchainId: id });
      if (pubReceipt.status !== "success") {
        return toast.error(
          `Campaign #${id} launched & funded but whitelist publish failed — use 'On-chain Sync' to republish`,
        );
      }
      toast.success(
        `On-chain campaign #${id} launched, funded & published — claims are now open`,
      );
    } catch {
      toast.error(
        "Launch failed — check wallet rejection / insufficient balance / not owner",
      );
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="mt-4 rounded-2xl bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-[var(--muted)]">
          Whitelist ({c.whitelist.length})
        </p>
        <p className="text-xs text-[var(--muted-2)]">
          {totalAllocated.toLocaleString()} {c.tokenSymbol} allocated
        </p>
      </div>

      {/* On-chain launch / status */}
      {launched && missingOnchain ? (
        <div className="mt-2 rounded-xl border border-[var(--down)]/30 bg-[var(--down-soft)] px-3 py-2 text-xs font-medium text-[var(--down)]">
          Campaign launched on previous contract (#{c.onchainId}) — not present on the current contract,
          cannot be controlled. Delete (removes local record) then launch a new campaign.
        </div>
      ) : launched ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--up)]/30 bg-[var(--up-soft)] px-3 py-2">
          <span className="flex items-center gap-2 text-xs font-medium text-[var(--up)]">
            <Check className="h-4 w-4" />
            On-chain launched · Campaign #{c.onchainId} — add wallets and sync to open claims immediately
          </span>
          <button
            onClick={syncOnChain}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Rocket className="h-3.5 w-3.5" />
            )}
            {syncing ? "Syncing…" : "On-chain Sync"}
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2">
          <span className="text-xs text-[var(--muted)]">
            {airdropLive
              ? `Ready to launch on-chain — deposits the full allocation of ${c.totalAllocation.toLocaleString()} ${c.tokenSymbol} into the contract and opens claims (unclaimed amount is swept on close).`
              : "Deploy the airdrop contract first before launching on-chain (npm run deploy:airdrop)."}
          </span>
          <button
            onClick={launchOnChain}
            disabled={!airdropLive || launching || c.whitelist.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {launching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Rocket className="h-3.5 w-3.5" />
            )}
            {launching ? "Launching…" : "Launch On-chain"}
          </button>
        </div>
      )}

      {/* Bulk entry: paste many, apply at once. Duplicates accumulate.
          Stays open after launch — additions go live via "On-chain Sync". */}
      <div className="mt-2">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs text-[var(--muted)]">Default amount</span>
          <input
            type="text"
            inputMode="decimal"
            value={formatAmountInput(defaultAmount)}
            onChange={(e) => setDefaultAmount(parseAmountInput(e.target.value))}
            placeholder="100"
            title={`Default amount when a line omits one (${c.tokenSymbol})`}
            className="w-28 rounded-xl border border-[var(--border-strong)] bg-[var(--card)] px-3 py-2 text-xs outline-none focus:border-[var(--accent)]"
          />
          <span className="text-xs text-[var(--muted-2)]">{c.tokenSymbol} / applied when omitted</span>
        </div>
        <textarea
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
          rows={5}
          spellCheck={false}
          placeholder={
            "One per line:\n0xabc…, 100\n0xdef…, 250\n0x123…       ← amount omitted: default used"
          }
          className="w-full resize-y rounded-xl border border-[var(--border-strong)] bg-[var(--card)] px-3 py-2 font-mono text-xs outline-none focus:border-[var(--accent)]"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3 text-xs">
            <span className="text-[var(--up)]">Valid {valid.length}</span>
            {invalid.length > 0 && (
              <span
                className="text-[var(--down)]"
                title={invalid
                  .map((r) => `line ${r.line}: ${r.error}`)
                  .join("\n")}
              >
                Errors {invalid.length}
              </span>
            )}
            {address && (
              <button
                onClick={addMyWallet}
                className="inline-flex items-center gap-1 font-medium text-[var(--accent)]"
              >
                <UserPlus className="h-3.5 w-3.5" />Add my wallet
              </button>
            )}
          </div>
          <button
            onClick={apply}
            disabled={valid.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Apply ({valid.length})
          </button>
        </div>
      </div>

      {/* Entries: per-wallet amount + claim state. Launched campaigns show the
          on-chain claim status (auto-synced); drafts keep the manual toggle. */}
      {c.whitelist.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {c.whitelist.map((w) => {
            const received =
              launched && claimStatus.loaded
                ? (claimStatus.received[w.address.toLowerCase()] ?? 0)
                : w.claimed
                  ? w.amount
                  : 0;
            const full = received > 0 && received >= w.amount;
            const partial = received > 0 && !full;
            return (
              <div
                key={w.address}
                className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs"
              >
                <span className="font-mono">{shortAddress(w.address)}</span>
                <div className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">
                    {w.amount.toLocaleString()} {c.tokenSymbol}
                  </span>
                  {launched ? (
                    <span
                      title="On-chain claim status (auto-synced)"
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                        full
                          ? "bg-[var(--up-soft)] text-[var(--up)]"
                          : partial
                            ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                            : "bg-[var(--surface-2)] text-[var(--muted)]"
                      }`}
                    >
                      {full && <Check className="h-3 w-3" />}
                      {full
                        ? "Received"
                        : partial
                          ? `Partial ${received.toLocaleString()}`
                          : "Pending"}
                    </span>
                  ) : (
                    <button
                      onClick={() =>
                        setWhitelistClaimed(c.id, w.address, !w.claimed)
                      }
                      title={
                        w.claimed ? "Mark as not received" : "Mark as received"
                      }
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold transition-colors ${
                        w.claimed
                          ? "bg-[var(--up-soft)] text-[var(--up)]"
                          : "bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      {w.claimed && <Check className="h-3 w-3" />}
                      {w.claimed ? "Received" : "Pending"}
                    </button>
                  )}
                  {!launched && (
                    <button
                      onClick={() => removeFromWhitelist(c.id, w.address)}
                      className="text-[var(--muted)] hover:text-[var(--down)]"
                      title="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm font-semibold">{value}</div>
      <div className="text-xs text-[var(--muted)]">{label}</div>
    </div>
  );
}
