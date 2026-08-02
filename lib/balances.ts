"use client";

import { useMemo } from "react";
import { erc20Abi, formatUnits } from "viem";
import {
  useAccount,
  useBalance as useNativeBalance,
  useReadContracts,
} from "wagmi";
import { useTokenRegistry } from "./token-registry";
import { NATIVE_SYMBOL } from "./chain";
import type { Token } from "./types";

const REFETCH_MS = 30_000;
const EMPTY: Record<string, number> = {};

/**
 * Real on-chain balances for every registry token, keyed by symbol.
 * Native XP via eth_getBalance, ERC-20s batched through multicall.
 * Returns {} while disconnected.
 */
export function useBalances(): Record<string, number> {
  const { address, isConnected } = useAccount();
  const { enabled: registryTokens } = useTokenRegistry();

  // ERC-20 tokens with a real contract (static registry + admin-added)
  const erc20Tokens = useMemo(
    () =>
      registryTokens.filter(
        (t): t is Token & { address: string } => t.address !== null,
      ),
    [registryTokens],
  );

  const native = useNativeBalance({
    address,
    query: { enabled: !!address, refetchInterval: REFETCH_MS },
  });

  const erc20 = useReadContracts({
    contracts: erc20Tokens.map((t) => ({
      address: t.address as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [address as `0x${string}`],
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
