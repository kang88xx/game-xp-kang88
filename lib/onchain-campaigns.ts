"use client";

// Reads airdrop campaigns straight from the MerkleAirdrop contract so EVERY
// visitor (not just the admin who created them) sees launched campaigns and can
// claim — no backend/database needed. Campaign state lives on-chain; the human
// name is pulled from the CampaignCreated event log (best-effort, falls back to
// "Airdrop #id" if the RPC can't serve the logs).
import { useMemo } from "react";
import { formatUnits } from "viem";
import { useReadContract, useReadContracts, usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { AIRDROP_ABI, AIRDROP_CONTRACT, airdropLive, CHAIN_ID } from "./airdrop";
import { useTokenRegistry } from "./token-registry";
import type { Token } from "./types";

const ZERO_ROOT =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export interface OnchainCampaign {
  onchainId: number;
  token: `0x${string}`;
  /** Resolved registry symbol, or a short address fallback. */
  tokenSymbol: string;
  tokenDecimals: number;
  /** merkleRoot == 0 → public/open claim; otherwise whitelist. */
  isPublic: boolean;
  merkleRoot: `0x${string}`;
  fundedWei: bigint;
  claimedWei: bigint;
  amountPerClaimWei: bigint;
  /** Display amounts (token units). */
  funded: number;
  claimed: number;
  amountPerClaim: number;
  /** epoch ms; 0 = no expiry. */
  endsAtMs: number;
  active: boolean;
  name: string;
  /**
   * Tokens funded at CREATION (from the CampaignCreated event) — the
   * allocation entered at launch. Stays fixed when the admin later grows the
   * whitelist via updateRoot, so progress bars keep a stable denominator.
   * null when the event log couldn't be read.
   */
  launchFunded: number | null;
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function resolveToken(
  address: string,
  all: Token[],
): { symbol: string; decimals: number } {
  const lower = address.toLowerCase();
  const t = all.find((x) => x.address && x.address.toLowerCase() === lower);
  return t
    ? { symbol: t.symbol, decimals: t.decimals }
    : { symbol: shortAddr(address), decimals: 18 };
}

/**
 * Live on-chain campaigns. Returns [] until a contract is configured. Public
 * campaigns are fully claimable by anyone from this data alone; whitelist
 * campaigns still need their off-chain allocation list to build a proof.
 */
export function useOnchainCampaigns(): {
  campaigns: OnchainCampaign[];
  isLoading: boolean;
} {
  const { all } = useTokenRegistry();
  const publicClient = usePublicClient();
  const contract = AIRDROP_CONTRACT as `0x${string}`;

  const { data: countData, isLoading: countLoading } = useReadContract({
    address: airdropLive ? contract : undefined,
    abi: AIRDROP_ABI,
    functionName: "campaignCount",
    chainId: CHAIN_ID,
    query: { enabled: airdropLive, refetchInterval: 30_000 },
  });

  const count = countData != null ? Number(countData) : 0;
  const ids = useMemo(
    () => Array.from({ length: count }, (_, i) => i + 1),
    [count],
  );

  const { data: rows, isLoading: rowsLoading } = useReadContracts({
    contracts: ids.map((id) => ({
      address: contract,
      abi: AIRDROP_ABI,
      functionName: "campaigns" as const,
      args: [BigInt(id)] as const,
      chainId: CHAIN_ID,
    })),
    query: { enabled: airdropLive && count > 0, refetchInterval: 30_000 },
  });

  // Name + initial funding from CampaignCreated logs — best-effort, never
  // blocks claiming.
  const { data: meta } = useQuery({
    queryKey: ["airdrop-campaign-meta", contract, count],
    enabled: airdropLive && count > 0 && !!publicClient,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<
      Record<number, { name?: string; fundedWei?: string }>
    > => {
      if (!publicClient) return {};
      try {
        const logs = await publicClient.getContractEvents({
          address: contract,
          abi: AIRDROP_ABI,
          eventName: "CampaignCreated",
          fromBlock: "earliest",
          toBlock: "latest",
        });
        const out: Record<number, { name?: string; fundedWei?: string }> = {};
        for (const log of logs) {
          const args = log.args as { id?: bigint; name?: string; funded?: bigint };
          if (args.id == null) continue;
          out[Number(args.id)] = {
            name: args.name || undefined,
            fundedWei: args.funded?.toString(),
          };
        }
        return out;
      } catch {
        return {}; // RPC can't serve the range → fall back to generated names
      }
    },
  });

  const campaigns = useMemo<OnchainCampaign[]>(() => {
    if (!rows) return [];
    const list: OnchainCampaign[] = [];
    rows.forEach((res, i) => {
      if (res.status !== "success" || !res.result) return;
      const r = res.result as readonly [
        `0x${string}`, // token
        `0x${string}`, // merkleRoot
        bigint, // funded
        bigint, // claimed
        bigint, // amountPerClaim
        bigint, // endsAt (uint64)
        boolean, // active
      ];
      const [token, merkleRoot, funded, claimed, amountPerClaim, endsAt, active] =
        r;
      // A zero-token row means the id doesn't exist — skip defensively.
      if (!token || /^0x0+$/.test(token)) return;
      const { symbol, decimals } = resolveToken(token, all);
      const id = ids[i];
      list.push({
        onchainId: id,
        token,
        tokenSymbol: symbol,
        tokenDecimals: decimals,
        isPublic: merkleRoot === ZERO_ROOT,
        merkleRoot,
        fundedWei: funded,
        claimedWei: claimed,
        amountPerClaimWei: amountPerClaim,
        funded: Number(formatUnits(funded, decimals)),
        claimed: Number(formatUnits(claimed, decimals)),
        amountPerClaim: Number(formatUnits(amountPerClaim, decimals)),
        endsAtMs: Number(endsAt) * 1000,
        active,
        name: meta?.[id]?.name ?? `Airdrop #${id}`,
        launchFunded: meta?.[id]?.fundedWei
          ? Number(formatUnits(BigInt(meta[id].fundedWei!), decimals))
          : null,
      });
    });
    return list;
  }, [rows, ids, all, meta]);

  return { campaigns, isLoading: countLoading || rowsLoading };
}

/** One allocation reconstructed from the chain: address + amount in base units. */
export interface PublishedAllocation {
  address: string;
  amountWei: string;
}

/**
 * Reconstruct a whitelist campaign's allocations from the on-chain
 * WhitelistPublished event(s). Any visitor can read this and build their own
 * Merkle proof — no admin-local data needed. The latest publish for the id wins.
 * Returns [] until data is available (or for public campaigns where enabled is false).
 */
export function usePublishedWhitelist(
  onchainId: number | undefined,
  enabled: boolean,
): { allocations: PublishedAllocation[]; isLoading: boolean } {
  const publicClient = usePublicClient();
  const contract = AIRDROP_CONTRACT as `0x${string}`;
  const on = airdropLive && enabled && onchainId != null && !!publicClient;

  const { data, isLoading } = useQuery({
    queryKey: ["airdrop-published-whitelist", contract, onchainId],
    enabled: on,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PublishedAllocation[]> => {
      if (!publicClient || onchainId == null) return [];
      try {
        const logs = await publicClient.getContractEvents({
          address: contract,
          abi: AIRDROP_ABI,
          eventName: "WhitelistPublished",
          args: { id: BigInt(onchainId) },
          fromBlock: "earliest",
          toBlock: "latest",
        });
        if (logs.length === 0) return [];
        // Latest publish wins (admin may republish a corrected list).
        const last = logs[logs.length - 1];
        const args = last.args as {
          accounts?: readonly string[];
          amounts?: readonly bigint[];
        };
        const accounts = args.accounts ?? [];
        const amounts = args.amounts ?? [];
        return accounts.map((address, i) => ({
          address,
          amountWei: (amounts[i] ?? 0n).toString(),
        }));
      } catch {
        return []; // RPC range limit → caller falls back to local data
      }
    },
  });

  return { allocations: data ?? [], isLoading };
}
