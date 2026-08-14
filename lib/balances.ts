"use client";

import { useMemo } from "react";
import { erc20Abi, formatUnits } from "viem";
import {
  useBalance as useNativeBalance,
  useReadContracts,
} from "wagmi";
import { useActiveAccount } from "./active-account";
import { useTokenRegistry } from "./token-registry";
import { CHAIN_ID, NATIVE_SYMBOL } from "./chain";
import type { Token } from "./types";

const REFETCH_MS = 30_000;
const EMPTY: Record<string, number> = {};

/**
 * Real on-chain balances for every registry token, keyed by symbol.
 * Native XP via eth_getBalance, ERC-20s batched through multicall.
 * Returns {} while disconnected.
 */
export function useBalances(): Record<string, number> {
  // wagmi 확장/인앱 + ZIGAP 딥링크 세션 어느 쪽이든 잔고를 읽는다 (읽기는
  // 지갑 서명이 필요 없어 RPC 로 직접 조회).
  const { address } = useActiveAccount();
  const isConnected = !!address;
  const { enabled: registryTokens } = useTokenRegistry();

  // ERC-20 tokens with a real contract (static registry + admin-added)
  const erc20Tokens = useMemo(
    () =>
      registryTokens.filter(
        (t): t is Token & { address: string } => t.address !== null,
      ),
    [registryTokens],
  );

  // chainId pinned to Xphere: without it these reads follow the wallet's
  // currently selected chain, silently showing balances from other networks.
  const native = useNativeBalance({
    address,
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: REFETCH_MS },
  });

  const erc20 = useReadContracts({
    contracts: erc20Tokens.map((t) => ({
      address: t.address as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [address as `0x${string}`],
      chainId: CHAIN_ID,
    })),
    query: { enabled: !!address, refetchInterval: REFETCH_MS },
  });

  return useMemo(() => {
    if (!isConnected || !address) return EMPTY;
    const out: Record<string, number> = {};
    if (native.data) {
      out[NATIVE_SYMBOL] = Number(
        formatUnits(native.data.value, native.data.decimals),
      );
    }
    erc20.data?.forEach((r, i) => {
      const t = erc20Tokens[i];
      if (r.status === "success") {
        out[t.symbol] = Number(formatUnits(r.result as bigint, t.decimals));
      }
    });
    return out;
  }, [isConnected, address, native.data, erc20.data, erc20Tokens]);
}

/** On-chain balance for one token symbol (0 while disconnected/loading). */
export function useBalance(symbol: string): number {
  return useBalances()[symbol] ?? 0;
}
