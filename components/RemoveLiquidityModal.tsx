"use client";

// Real on-chain liquidity withdrawal: approve the LP token for the router,
// then removeLiquidity / removeLiquidityETH for the chosen share.
import { useMemo, useState } from "react";
import { X, Minus, Loader2 } from "lucide-react";
import { erc20Abi, formatUnits } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useDexStore } from "@/lib/store";
import { useMarket } from "@/lib/market";
import { formatNumber, formatUsd } from "@/lib/format";
import { PANCAKE_ROUTER, CHAIN_ID, NATIVE_SYMBOL } from "@/lib/chain";
import { applySlippage } from "@/lib/pancake";
import {
  LIQUIDITY_ROUTER_ABI,
  liquidityDeadline,
  liquidityTokenAddress,
  useAllTokenMap,
  usePoolsOnchain,
} from "@/lib/liquidity";
import { toast } from "@/components/toast";
import { TokenLogo } from "./TokenLogo";

const SLIPPAGE_PCT = 1;
const PCTS = [25, 50, 75, 100] as const;

export function RemoveLiquidityModal({
  poolId,
  onClose,
}: {
  poolId: string | null;
  onClose: () => void;
}) {
  const pools = useDexStore((s) => s.pools);
  const recordTransaction = useDexStore((s) => s.recordTransaction);
  const { address: wallet, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const market = useMarket();
  const tokenMap = useAllTokenMap();
  const [pct, setPct] = useState<number>(100);
  const [removing, setRemoving] = useState(false);

  const pool = useMemo(
    () => pools.find((p) => p.id === poolId) ?? null,
    [pools, poolId],
  );
  const onchainPools = useMemo(() => (pool ? [pool] : []), [pool]);
  const onchainMap = usePoolsOnchain(onchainPools);
  const onchain = pool ? onchainMap[pool.id] : undefined;

  if (!poolId || !pool) return null;
  const tA = tokenMap[pool.token0];
  const tB = tokenMap[pool.token1];
  if (!tA || !tB || !onchain) return null;

  const { lpBalance, totalSupply, reserveA, reserveB, pairAddress } = onchain;
  const lpToBurn = (lpBalance * BigInt(Math.round(pct))) / 100n;
  const outA = totalSupply > 0n ? (reserveA * lpToBurn) / totalSupply : 0n;
  const outB = totalSupply > 0n ? (reserveB * lpToBurn) / totalSupply : 0n;
  const nA = Number(formatUnits(outA, tA.decimals));
  const nB = Number(formatUnits(outB, tB.decimals));
  const usdTotal =
    nA * (market[pool.token0]?.priceUsd ?? 0) +
    nB * (market[pool.token1]?.priceUsd ?? 0);

  const remove = async () => {
    if (!wallet || !publicClient) return toast.error("Connect your wallet");
    if (chainId !== CHAIN_ID)
      return toast.error("Switch your wallet network to Xphere");
    if (!pairAddress || lpToBurn <= 0n)
      return toast.error("No liquidity to remove");

    const addrA = liquidityTokenAddress(pool.token0, tokenMap);
    const addrB = liquidityTokenAddress(pool.token1, tokenMap);
    if (!addrA || !addrB) return toast.error("Token address not found");

    try {
      setRemoving(true);
      // 1) Approve the LP token for the router (LP pairs are plain ERC-20s).
      const allowance = await publicClient.readContract({
        address: pairAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [wallet, PANCAKE_ROUTER],
      });
      if (allowance < lpToBurn) {
        toast.info("Approving LP token… confirm in your wallet");
        const approveHash = await writeContractAsync({
          address: pairAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [PANCAKE_ROUTER, lpToBurn],
          chainId: CHAIN_ID,
        });
        const approveReceipt = await publicClient.waitForTransactionReceipt({
          hash: approveHash,
        });
        if (approveReceipt.status !== "success")
          throw new Error("LP approve reverted");
      }

      // 2) Withdraw with 1% slippage tolerance on both sides.
      const minA = applySlippage(outA, SLIPPAGE_PCT);
      const minB = applySlippage(outB, SLIPPAGE_PCT);
      const deadline = liquidityDeadline();
      const aIsBnb = pool.token0 === NATIVE_SYMBOL;
      const bIsBnb = pool.token1 === NATIVE_SYMBOL;

      toast.info("Sending remove liquidity transaction… confirm in your wallet");
      let hash: `0x${string}`;
      if (aIsBnb || bIsBnb) {
        const tokenAddr = aIsBnb ? addrB : addrA;
        const minToken = aIsBnb ? minB : minA;
        const minBnb = aIsBnb ? minA : minB;
        hash = await writeContractAsync({
          address: PANCAKE_ROUTER,
          abi: LIQUIDITY_ROUTER_ABI,
          functionName: "removeLiquidityETH",
          args: [tokenAddr, lpToBurn, minToken, minBnb, wallet, deadline],
          chainId: CHAIN_ID,
        });
      } else {
        hash = await writeContractAsync({
          address: PANCAKE_ROUTER,
          abi: LIQUIDITY_ROUTER_ABI,
          functionName: "removeLiquidity",
          args: [addrA, addrB, lpToBurn, minA, minB, wallet, deadline],
          chainId: CHAIN_ID,
        });
      }
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        return toast.error("Remove liquidity transaction failed");

      recordTransaction(
        "remove-liquidity",
        `Removed ${pct}% of ${pool.token0}/${pool.token1} liquidity (~${formatNumber(nA, 4)} ${pool.token0} + ${formatNumber(nB, 4)} ${pool.token1})`,
      );
      toast.success("Liquidity removed — tokens have been sent to your wallet");
      onClose();
    } catch {
      toast.error("Remove liquidity failed — check for wallet rejection");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/40 p-4 pt-24">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Remove liquidity from ${pool.token0} / ${pool.token1}`}
        className="animate-fade-in relative w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
      >
        <div className="flex items-center justify-between p-5">
          <div className="flex items-center gap-2">
            <TokenLogo symbol={pool.token0} size={28} />
            <TokenLogo symbol={pool.token1} size={28} />
            <h3 className="ml-1 text-base font-semibold">
              {pool.token0} / {pool.token1} Withdraw
            </h3>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--surface)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pb-5">
          <div className="rounded-2xl bg-[var(--surface)] p-4">
            <div className="text-xs text-[var(--muted)]">Withdraw Amount</div>
            <div className="mt-1 text-3xl font-semibold">{pct}%</div>
            <div className="mt-3 flex gap-2">
              {PCTS.map((v) => (
                <button
                  key={v}
                  onClick={() => setPct(v)}
                  className={`flex-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    pct === v
                      ? "bg-[var(--accent)] text-white"
                      : "bg-[var(--card)] text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {v}%
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 space-y-2 rounded-2xl border border-[var(--border)] p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <TokenLogo symbol={pool.token0} size={22} /> {pool.token0}
              </span>
              <span className="font-semibold tabular-nums">
                {formatNumber(nA, 6)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <TokenLogo symbol={pool.token1} size={22} /> {pool.token1}
              </span>
              <span className="font-semibold tabular-nums">
                {formatNumber(nB, 6)}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-[var(--border)] pt-2 text-xs text-[var(--muted)]">
              <span>Estimated received</span>
              <span>{formatUsd(usdTotal)}</span>
            </div>
          </div>

          <button
            onClick={remove}
            disabled={removing || lpToBurn <= 0n}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--muted-2)]"
          >
            {removing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Minus className="h-4 w-4" />
            )}
            {removing ? "Withdrawing…" : "Remove Liquidity"}
          </button>
        </div>
      </div>
    </div>
  );
}
