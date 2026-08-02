"use client";

import { useMemo } from "react";
import { formatUnits } from "viem";
import { useReadContracts } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { PANCAKE_FACTORY, CHAIN_ID } from "./chain";
import { useMarket } from "./market";
import { useAllTokenMap, liquidityTokenAddress } from "./liquidity";
import type { Pool } from "./types";

// Minimal ABIs for live pool reads.
const FACTORY_ABI = [
  {
    type: "function",
    name: "getPair",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
    ],
    outputs: [{ name: "pair", type: "address" }],
  },
] as const;

const PAIR_ABI = [
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "_reserve0", type: "uint112" },
      { name: "_reserve1", type: "uint112" },
      { name: "_blockTimestampLast", type: "uint32" },
    ],
  },
  {
    type: "function",
    name: "token0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

/** Sorted symbol key matching the server volume map, e.g. "KDG-USDX". */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join("-");
}

export interface PoolStats {
  tvlUsd: number;
  volume24h: number;
  apr: number; // percent
  loading: boolean;
  available: boolean; // false when the pair has no on-chain liquidity/data
}

const UNAVAILABLE: PoolStats = {
  tvlUsd: 0,
  volume24h: 0,
  apr: 0,
  loading: false,
  available: false,
};

/**
 * Live, real pool stats keyed by pool id:
 *  - TVL  = on-chain reserves × live USD prices (balanced-pool 2× fallback
 *           when only one side has a price feed).
 *  - APR  = Fee APR from this site's rolling 24h per-pool volume:
 *           (volume24h × feeTier% × 365) / TVL.
 *
 * Resolves each pool's pair via the PumpkinSwap factory, so no pair address
 * needs to be stored. Refreshes every 60s.
 */
export function usePoolStats(pools: Pool[]): Record<string, PoolStats> {
  const market = useMarket();
  // Static registry + admin-added tokens, so custom-token pools resolve too.
  const tokenMap = useAllTokenMap();

  // Per-pool 24h volume (USD) by pair key, from server analytics.
  const { data: volByPair } = useQuery<Record<string, number>>({
    queryKey: ["pool-volume"],
    queryFn: async () => {
      const res = await fetch("/api/analytics/pool-volume");
      if (!res.ok) throw new Error("pool-volume fetch failed");
      return res.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Pools whose pair address is resolvable on-chain (both sides have addresses).
  const entries = useMemo(
    () =>
      pools
        .map((pool) => {
          const a = liquidityTokenAddress(pool.token0, tokenMap);
          const b = liquidityTokenAddress(pool.token1, tokenMap);
          if (!a || !b || a.toLowerCase() === b.toLowerCase()) return null;
          return { pool, a, b };
        })
        .filter(
          (e): e is { pool: Pool; a: `0x${string}`; b: `0x${string}` } =>
            e !== null,
        ),
    [pools, tokenMap],
  );

  // Round 1 — resolve pair addresses via factory.getPair.
  const { data: pairData } = useReadContracts({
    contracts: entries.map((e) => ({
      address: PANCAKE_FACTORY,
      abi: FACTORY_ABI,
      functionName: "getPair" as const,
      args: [e.a, e.b] as const,
      chainId: CHAIN_ID,
    })),
    query: { enabled: entries.length > 0, refetchInterval: 60_000 },
  });

  const pairAddrs = useMemo(
    () =>
      entries.map((_, i) => {
        const r = pairData?.[i];
        if (r?.status !== "success") return null;
        const addr = r.result as string;
        return addr && addr.toLowerCase() !== ZERO_ADDR
          ? (addr as `0x${string}`)
          : null;
      }),
    [entries, pairData],
  );

  // Round 2 — read reserves + token0 ordering for each resolved pair.
  // Two calls per pair, interleaved; `callMap[k]` = entry index for pair k.
  const { reserveContracts, callMap } = useMemo(() => {
    const contracts: {
      address: `0x${string}`;
      abi: typeof PAIR_ABI;
      functionName: "getReserves" | "token0";
      chainId: number;
    }[] = [];
    const map: number[] = [];
    entries.forEach((_, i) => {
      const pa = pairAddrs[i];
      if (!pa) return;
      map.push(i);
      contracts.push({ address: pa, abi: PAIR_ABI, functionName: "getReserves", chainId: CHAIN_ID });
      contracts.push({ address: pa, abi: PAIR_ABI, functionName: "token0", chainId: CHAIN_ID });
    });
    return { reserveContracts: contracts, callMap: map };
  }, [entries, pairAddrs]);

  const { data: reserveData } = useReadContracts({
    contracts: reserveContracts,
    query: { enabled: reserveContracts.length > 0, refetchInterval: 60_000 },
  });

  return useMemo(() => {
    const out: Record<string, PoolStats> = {};
    const loading =
      (entries.length > 0 && pairData === undefined) ||
      (reserveContracts.length > 0 && reserveData === undefined);

    // Default every pool to unavailable (or loading).
    pools.forEach((p) => {
      out[p.id] = { ...UNAVAILABLE, loading };
    });

    callMap.forEach((entryIdx, k) => {
      const { pool } = entries[entryIdx];
      const resRes = reserveData?.[2 * k];
      const t0Res = reserveData?.[2 * k + 1];
      if (resRes?.status !== "success" || t0Res?.status !== "success") return;

      const [r0, r1] = resRes.result as readonly [bigint, bigint, number];
      const token0Addr = (t0Res.result as string).toLowerCase();
      const a = entries[entryIdx].a.toLowerCase();
      const tokenA = tokenMap[pool.token0];
      const tokenB = tokenMap[pool.token1];
      if (!tokenA || !tokenB) return;

      // Map reserves back to token0/token1 of THIS pool.
      const aIsToken0 = a === token0Addr;
      const reserveA = aIsToken0 ? r0 : r1;
      const reserveB = aIsToken0 ? r1 : r0;
      const amtA = Number(formatUnits(reserveA, tokenA.decimals));
      const amtB = Number(formatUnits(reserveB, tokenB.decimals));

      const priceA = market[pool.token0]?.priceUsd ?? 0;
      const priceB = market[pool.token1]?.priceUsd ?? 0;
      const valA = amtA * priceA;
      const valB = amtB * priceB;

      // Balanced AMM pools hold ~50/50 by value: if only one side has a price
      // feed, total ≈ 2× the priced side.
      let tvlUsd = 0;
      if (priceA > 0 && priceB > 0) tvlUsd = valA + valB;
      else if (priceA > 0) tvlUsd = valA * 2;
      else if (priceB > 0) tvlUsd = valB * 2;

      const volume24h = volByPair?.[pairKey(pool.token0, pool.token1)] ?? 0;
      const apr =
        tvlUsd > 0 ? (volume24h * pool.feeTier * 365) / tvlUsd : 0;

      out[pool.id] = { tvlUsd, volume24h, apr, loading: false, available: true };
    });

    return out;
  }, [
    pools,
    entries,
    tokenMap,
    callMap,
    pairData,
    reserveData,
    reserveContracts.length,
    market,
    volByPair,
  ]);
}
