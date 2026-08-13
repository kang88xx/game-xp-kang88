"use client";

import { useState } from "react";
import { useMetaMask } from "@/lib/use-metamask";
import { Check, Lock, Globe, ShieldCheck, Loader2 } from "lucide-react";
import { formatUnits, parseUnits } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { TOKEN_MAP } from "@/lib/mock-data";
import { useDexStore, useHydrated } from "@/lib/store";
import { daysUntil, formatCompact, formatUsd, isPast } from "@/lib/format";
import { merkleProof } from "@/lib/merkle";
import { AIRDROP_ABI, AIRDROP_CONTRACT, airdropLive, CHAIN_ID } from "@/lib/airdrop";
import {
  useOnchainCampaigns,
  usePublishedWhitelist,
  type OnchainCampaign,
} from "@/lib/onchain-campaigns";
import { TokenLogo } from "@/components/TokenLogo";
import { toast } from "@/components/toast";
import { ArrowChip } from "@/components/ui";
import { XphereMark } from "@/components/XphereLogo";
import type { AirdropCampaign } from "@/lib/types";

export default function AirdropPage() {
  const hydrated = useHydrated();
  const { campaigns: onchain, isLoading } = useOnchainCampaigns();
  const localCampaigns = useDexStore((s) => s.campaigns);

  // On-chain campaigns are the claimable source of truth — every visitor reads
  // them straight from the contract, no admin-local data needed. Time-expired
  // campaigns are hidden even while their on-chain `active` flag is still set
  // (the owner may not have swept them yet).
  const liveOnchain = onchain.filter(
    (c) => c.active && (c.endsAtMs === 0 || !isPast(c.endsAtMs)),
  );
  // Launched = exists on-chain at all (paused included) — otherwise a paused
  // campaign's local record would wrongly reappear as a "preview" draft.
  const launchedIds = new Set(onchain.map((c) => c.onchainId));

  // Local campaigns not yet launched on-chain → shown as previews (not claimable).
  const drafts = localCampaigns.filter(
    (c) => c.active && (c.onchainId == null || !launchedIds.has(c.onchainId)),
  );

  const loading = !hydrated || isLoading;
  const nothing = !loading && liveOnchain.length === 0 && drafts.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div>
        <div>
          <h1 className="grad-text text-3xl font-medium tracking-tight">
            Claim
          </h1>
          <p className="text-sm text-[var(--muted)]">
            Claim token rewards from active campaigns.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <div className="flex h-64 items-center justify-center rounded-3xl bg-[var(--surface-2)] animate-pulse-soft">
            <span className="x-spin opacity-25">
              <XphereMark size={28} />
            </span>
          </div>
          <div className="flex h-64 items-center justify-center rounded-3xl bg-[var(--surface-2)] animate-pulse-soft">
            <span className="x-spin opacity-25">
              <XphereMark size={28} />
            </span>
          </div>
        </div>
      ) : nothing ? (
        <div className="mt-10 rounded-3xl border border-dashed border-[var(--border-strong)] py-16 text-center">
          <span className="dot-stagger mb-5">
            <span /><span /><span /><span /><span />
          </span>
          <p className="text-sm text-[var(--muted)]">
            No active campaigns right now.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {liveOnchain.map((c) => (
            <OnchainCampaignCard
              key={`oc-${c.onchainId}`}
              campaign={c}
              localCampaigns={localCampaigns}
            />
          ))}
          {drafts.map((c) => (
            <DraftCampaignCard key={c.id} campaign={c} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A live on-chain campaign — claimable by anyone (public) or by whitelist proof. */
function OnchainCampaignCard({
  campaign: c,
  localCampaigns,
}: {
  campaign: OnchainCampaign;
  localCampaigns: AirdropCampaign[];
}) {
  const connected = useDexStore((s) => s.connected);
  const recordClaim = useDexStore((s) => s.recordClaim);
  const { open: openWalletModal } = useMetaMask();
  const { address: wallet, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const [claiming, setClaiming] = useState(false);

  // On-chain claim status for the connected wallet (the source of truth).
  const { data: claimedOnchain } = useReadContract({
    address: AIRDROP_CONTRACT as `0x${string}`,
    abi: AIRDROP_ABI,
    functionName: "hasClaimed",
    args: wallet ? [BigInt(c.onchainId), wallet] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!wallet },
  });
  // Cumulative claimed amount — v5 contracts only. On a v4 contract this read
  // fails and the boolean above decides (partial claims don't exist there).
  const { data: claimedAmtOnchain } = useReadContract({
    address: AIRDROP_CONTRACT as `0x${string}`,
    abi: AIRDROP_ABI,
    functionName: "claimedAmount",
    args: wallet ? [BigInt(c.onchainId), wallet] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!wallet },
  });

  const token = TOKEN_MAP[c.tokenSymbol];
  const ended = c.endsAtMs !== 0 && isPast(c.endsAtMs);
  const remainingWei = c.fundedWei - c.claimedWei;
  const soldOut = c.isPublic
    ? remainingWei < c.amountPerClaimWei
    : remainingWei <= 0n;
  // Progress denominator = the on-chain funded pool. Campaigns are funded with
  // their full allocation budget at launch (e.g. 1,000,000), so this reads the
  // same total for every visitor and the bar fills as wallets claim.
  const localMatch = localCampaigns.find((lc) => lc.onchainId === c.onchainId);
  const totalForBar = c.funded > 0 ? c.funded : (c.launchFunded ?? 0);
  const progress =
    totalForBar > 0 ? Math.min(100, (c.claimed / totalForBar) * 100) : 0;

  // Whitelist proofs need the (address, amount) list. We read it straight from
  // the chain (published as an event at launch), so any visitor can claim. The
  // admin's local store is only a fallback if the event can't be read.
  const dec = token?.decimals ?? c.tokenDecimals;
  const { allocations: published } = usePublishedWhitelist(
    c.onchainId,
    !c.isPublic,
  );
  const localWl = !c.isPublic ? localMatch : undefined;

  const wlAllocs: { address: string; amountWei: string }[] = c.isPublic
    ? []
    : published.length > 0
      ? published
      : (localWl?.whitelist ?? []).map((w) => ({
          address: w.address,
          amountWei: parseUnits(String(w.amount), dec).toString(),
        }));

  const myAlloc =
    !c.isPublic && wallet
      ? wlAllocs.find((a) => a.address.toLowerCase() === wallet.toLowerCase())
      : undefined;
  const claimAmount = c.isPublic
    ? c.amountPerClaim
    : myAlloc
      ? Number(formatUnits(BigInt(myAlloc.amountWei), dec))
      : 0;

  const myAllocWei = myAlloc ? BigInt(myAlloc.amountWei) : 0n;
  // Tokens this wallet already pulled out. v5 reports the exact cumulative
  // amount; v4 only has the boolean, which there always means the full
  // allocation (partial claims don't exist on v4).
  const walletClaimedWei =
    claimedAmtOnchain != null
      ? claimedAmtOnchain
      : claimedOnchain
        ? c.isPublic
          ? c.amountPerClaimWei
          : myAllocWei
        : 0n;
  // Whitelist allocations are cumulative — when the admin grows a wallet's
  // amount after it claimed, the difference becomes claimable again (v5).
  const remainingAllocWei =
    myAllocWei > walletClaimedWei ? myAllocWei - walletClaimedWei : 0n;
  const alreadyClaimed = c.isPublic
    ? walletClaimedWei > 0n
    : walletClaimedWei > 0n && remainingAllocWei === 0n;
  /** What the next claim tx actually pays out. */
  const claimableNow = c.isPublic
    ? c.amountPerClaim
    : Number(formatUnits(remainingAllocWei, dec));

  let eligible = true;
  let reason = "";
  if (!c.isPublic) {
    eligible = !!myAlloc;
    reason =
      wlAllocs.length === 0
        ? "Whitelist data isn't available yet"
        : "Your wallet is not whitelisted";
  }

  const doClaim = async () => {
    if (!wallet || !publicClient) return;
    if (chainId !== CHAIN_ID)
      return toast.error("Switch your wallet network to Xphere");
    try {
      setClaiming(true);
      toast.info("Please approve the claim transaction in your wallet");
      let hash: `0x${string}`;
      if (c.isPublic) {
        hash = await writeContractAsync({
          address: AIRDROP_CONTRACT as `0x${string}`,
          abi: AIRDROP_ABI,
          functionName: "claimPublic",
          args: [BigInt(c.onchainId)],
          chainId: CHAIN_ID,
        });
      } else {
        if (wlAllocs.length === 0)
          return toast.error("Failed to load whitelist data");
        const pf = merkleProof(wlAllocs, wallet);
        if (!pf) return toast.error("This wallet is not on the whitelist");
        hash = await writeContractAsync({
          address: AIRDROP_CONTRACT as `0x${string}`,
          abi: AIRDROP_ABI,
          functionName: "claim",
          args: [BigInt(c.onchainId), BigInt(pf.amountWei), pf.proof],
          chainId: CHAIN_ID,
        });
      }
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") return toast.error("Claim failed");
      recordClaim(c.onchainId.toString());
      toast.success(
        `Claimed ${claimableNow.toLocaleString()} ${c.tokenSymbol}!`,
      );
      // Refresh hasClaimed + on-chain campaign state.
      queryClient.invalidateQueries();
    } catch {
      toast.error("Claim failed: already claimed or rejected in wallet");
    } finally {
      setClaiming(false);
    }
  };

  const canClaim =
    eligible &&
    !ended &&
    !soldOut &&
    !alreadyClaimed &&
    (c.isPublic || remainingAllocWei > 0n);

  return (
    <div className="flex flex-col rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 transition-all duration-200 hover:-translate-y-1 hover:border-[var(--border-strong)] hover:shadow-xl">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <TokenLogo symbol={c.tokenSymbol} size={40} />
          <h3 className="truncate font-semibold">{c.name}</h3>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">
            {c.isPublic ? (
              <Globe className="h-3.5 w-3.5" />
            ) : (
              <Lock className="h-3.5 w-3.5" />
            )}
            {c.isPublic ? "Public" : "Whitelist"}
          </span>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${
            ended
              ? "bg-[var(--surface-2)] text-[var(--muted)]"
              : "bg-[var(--accent-soft)] text-[var(--accent-bright)]"
          }`}
        >
          {!ended && (
            <span className="dot-live h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          )}
          {ended ? "Ended" : c.endsAtMs === 0 ? "Live" : daysUntil(c.endsAtMs)}
        </span>
      </div>

      <div className="mt-4 flex items-end justify-between rounded-2xl bg-[var(--surface)] px-4 py-2.5">
        <div>
          <p className="text-xs text-[var(--muted)]">
            {!c.isPublic && myAlloc ? "Your allocation" : "Reward per wallet"}
          </p>
          <p className="text-xl font-bold">
            {c.isPublic || myAlloc
              ? `${claimAmount.toLocaleString()} ${c.tokenSymbol}`
              : c.tokenSymbol}
          </p>
        </div>
        {(c.isPublic || myAlloc) && (
          <p className="text-sm text-[var(--muted)]">
            ≈ {formatUsd(claimAmount * (token?.priceUsd ?? 0))}
          </p>
        )}
      </div>

      {/* Progress (claimed / funded, read from chain) */}
      <div className="mt-3.5">
        <div className="flex justify-between text-xs text-[var(--muted)]">
          <span>{progress.toFixed(1)}% claimed</span>
          <span>
            {formatCompact(c.claimed)} / {formatCompact(totalForBar)}{" "}
            {c.tokenSymbol}
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Allocation grew after a claim — the difference is claimable (v5). */}
      {!c.isPublic && walletClaimedWei > 0n && remainingAllocWei > 0n && (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-[var(--up-soft)] px-3 py-2 text-xs text-[var(--up)]">
          <Check className="h-3.5 w-3.5" />
          Already claimed {Number(formatUnits(walletClaimedWei, dec)).toLocaleString()}{" "}
          {c.tokenSymbol} · {claimableNow.toLocaleString()}{" "}
          {c.tokenSymbol} additional claimable
        </div>
      )}

      <div className="mt-auto pt-4">
        {!connected ? (
          <button
            onClick={() => openWalletModal()}
            className="h-12 w-full rounded-full bg-[var(--accent)] font-semibold text-white transition-all hover:bg-[var(--accent-hover)] active:scale-[0.985]"
          >
            Connect to claim
          </button>
        ) : alreadyClaimed ? (
          <button
            disabled
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[var(--up-soft)] font-semibold text-[var(--up)]"
          >
            <Check className="h-5 w-5" />
            Claimed
          </button>
        ) : canClaim ? (
          <button
            onClick={doClaim}
            disabled={claiming}
            className="group flex h-12 w-full items-center justify-center gap-2.5 rounded-full bg-[var(--accent)] font-semibold text-white transition-all hover:bg-[var(--accent-hover)] active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {claiming && <Loader2 className="h-5 w-5 animate-spin" />}
            {claiming
              ? "Claiming…"
              : `Claim ${claimableNow.toLocaleString()} ${c.tokenSymbol}`}
            {!claiming && <ArrowChip />}
          </button>
        ) : (
          <button
            disabled
            className={`flex h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-full font-semibold ${
              !ended && !soldOut && !eligible
                ? "bg-[var(--down-soft)] text-[var(--down)]"
                : "bg-[var(--surface-2)] text-[var(--muted-2)]"
            }`}
          >
            {!ended && !soldOut && !eligible && (
              <ShieldCheck className="h-4 w-4" />
            )}
            {ended ? "Ended" : soldOut ? "Fully claimed" : reason}
          </button>
        )}
      </div>
    </div>
  );
}

/** A local draft not yet launched on-chain — preview only, not claimable. */
function DraftCampaignCard({ campaign: c }: { campaign: AirdropCampaign }) {
  const token = TOKEN_MAP[c.tokenSymbol];
  const isWl = c.eligibility === "whitelist";
  const claimedAlloc = c.claimedCount * c.amountPerClaim;
  const progress = Math.min(100, (claimedAlloc / c.totalAllocation) * 100);
  const ended = isPast(c.endsAt);

  return (
    <div className="flex flex-col rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 transition-all duration-200 hover:-translate-y-1 hover:border-[var(--border-strong)] hover:shadow-xl">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <TokenLogo symbol={c.tokenSymbol} size={40} />
          <h3 className="truncate font-semibold">{c.name}</h3>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">
            {isWl ? (
              <Lock className="h-3.5 w-3.5" />
            ) : (
              <Globe className="h-3.5 w-3.5" />
            )}
            {isWl ? "Whitelist" : "Public"}
          </span>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${
            ended
              ? "bg-[var(--surface-2)] text-[var(--muted)]"
              : "bg-[var(--accent-soft)] text-[var(--accent-bright)]"
          }`}
        >
          {!ended && (
            <span className="dot-live h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          )}
          {ended ? "Ended" : daysUntil(c.endsAt)}
        </span>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">
        {c.description}
      </p>

      <div className="mt-4 flex items-end justify-between rounded-2xl bg-[var(--surface)] px-4 py-2.5">
        <div>
          <p className="text-xs text-[var(--muted)]">Reward per wallet</p>
          <p className="text-xl font-bold">
            {c.amountPerClaim.toLocaleString()} {c.tokenSymbol}
          </p>
        </div>
        <p className="text-sm text-[var(--muted)]">
          ≈ {formatUsd(c.amountPerClaim * (token?.priceUsd ?? 0))}
        </p>
      </div>

      <div className="mt-3.5">
        <div className="flex justify-between text-xs text-[var(--muted)]">
          <span>{progress.toFixed(1)}% claimed</span>
          <span>
            {formatCompact(claimedAlloc)} / {formatCompact(c.totalAllocation)}{" "}
            {c.tokenSymbol}
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="mt-auto pt-4">
        <button
          disabled
          className="h-12 w-full rounded-full bg-[var(--surface-2)] font-semibold text-[var(--muted-2)]"
        >
          {airdropLive
            ? "Waiting for on-chain launch (Admin)"
            : "On-chain claims coming soon"}
        </button>
      </div>
    </div>
  );
}
