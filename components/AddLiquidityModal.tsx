"use client";

// Real on-chain liquidity deposit: approve both sides for the PancakeSwap V2
// router, then addLiquidity / addLiquidityETH. When the pair already has
// reserves the two amounts stay locked to the on-chain ratio; the first
// deposit into an empty pair sets the initial price freely.
import { useEffect, useMemo, useRef, useState } from "react";
import { X, Plus, Loader2 } from "lucide-react";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { useDexStore, useHydrated } from "@/lib/store";
import { useBalances } from "@/lib/balances";
import { useMarket } from "@/lib/market";
import { formatNumber, formatUsd, formatAmountInput, parseAmountInput } from "@/lib/format";
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

// Deposit slippage tolerance (percent) for the router's min amounts.
const LIQUIDITY_SLIPPAGE_PCT = 1;

export function AddLiquidityModal({
  poolId,
  onClose,
}: {
  poolId: string | null;
  onClose: () => void;
}) {
  const hydrated = useHydrated();
  const connected = useDexStore((s) => s.connected);
  const pools = useDexStore((s) => s.pools);
  const recordTransaction = useDexStore((s) => s.recordTransaction);
  const { open: openWalletModal } = useAppKit();
  const { address: wallet, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const market = useMarket();
  const balances = useBalances();
  const tokenMap = useAllTokenMap();
  const [amount0, setAmount0] = useState("");
  const [amount1, setAmount1] = useState("");
  const [supplying, setSupplying] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const pool = useMemo(
    () => pools.find((p) => p.id === poolId) ?? null,
    [pools, poolId],
  );
  const onchainPools = useMemo(() => (pool ? [pool] : []), [pool]);
  const onchainMap = usePoolsOnchain(onchainPools);
  const onchain = pool ? onchainMap[pool.id] : undefined;

  // Focus trap: keep keyboard focus inside the dialog while it is open,
  // cycle Tab/Shift+Tab within it, and restore focus to the trigger on close.
  useEffect(() => {
    if (!poolId) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null)
        : [];

    // move focus into the dialog (prefer the amount field)
    const amountInput = panel?.querySelector<HTMLInputElement>("input");
    (amountInput ?? focusable()[0])?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusable();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [poolId, onClose]);

  if (!poolId || !pool) return null;

  const tA = tokenMap[pool.token0];
  const tB = tokenMap[pool.token1];
  if (!tA || !tB) return null;

  const p0 = market[pool.token0]?.priceUsd ?? 0;
  const p1 = market[pool.token1]?.priceUsd ?? 0;

  // Pair ratio (token1 per 1 token0): on-chain reserves are the source of
  // truth; an empty/new pair has no ratio — the first deposit sets the price.
  const hasReserves =
    !!onchain?.exists && onchain.reserveA > 0n && onchain.reserveB > 0n;
  const ratio01 = hasReserves
    ? Number(formatUnits(onchain!.reserveB, tB.decimals)) /
      Number(formatUnits(onchain!.reserveA, tA.decimals))
    : 0;

  const n0 = parseFloat(amount0) || 0;
  const n1 = parseFloat(amount1) || 0;
  const usd0 = n0 * p0;
  const usd1 = n1 * p1;
  const total = usd0 + usd1;

  const bal0 = balances[pool.token0] ?? 0;
  const bal1 = balances[pool.token1] ?? 0;
  const enough = n0 <= bal0 && n1 <= bal1;

  const fmtAmt = (n: number) => (n > 0 ? String(Number(n.toFixed(6))) : "");

  // With reserves, typing one side recomputes the other at the pair ratio.
  // First deposit: both sides are free.
  const onChange0 = (v: string) => {
    setAmount0(v);
    if (!hasReserves) return;
    const n = parseFloat(v);
    setAmount1(n > 0 && ratio01 > 0 ? fmtAmt(n * ratio01) : "");
  };
  const onChange1 = (v: string) => {
    setAmount1(v);
    if (!hasReserves) return;
    const n = parseFloat(v);
    setAmount0(n > 0 && ratio01 > 0 ? fmtAmt(n / ratio01) : "");
  };
  // Quick presets set a total USD amount, split 50/50 into token counts.
  const setTotalUsd = (usd: number) => {
    if (p0 <= 0) return;
    const a0 = usd / 2 / p0;
    if (hasReserves) onChange0(fmtAmt(a0));
    else {
      setAmount0(fmtAmt(a0));
      if (p1 > 0) setAmount1(fmtAmt(usd / 2 / p1));
    }
  };
  const setMax0 = () => onChange0(bal0 > 0 ? fmtAmt(bal0) : "");
  const setMax1 = () => onChange1(bal1 > 0 ? fmtAmt(bal1) : "");

  /** Approve `amount` of an ERC-20 for the router if allowance is short. */
  const ensureAllowance = async (
    token: `0x${string}`,
    amount: bigint,
    label: string,
  ) => {
    const allowance = await publicClient!.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [wallet!, PANCAKE_ROUTER],
    });
    if (allowance >= amount) return;
    toast.info(`${label} 사용 승인 중… 지갑에서 확인하세요`);
    const hash = await writeContractAsync({
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [PANCAKE_ROUTER, amount],
      chainId: CHAIN_ID,
    });
    const receipt = await publicClient!.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success")
      throw new Error(`${label} approve reverted`);
  };

  const supply = async () => {
    if (!wallet || !publicClient) return toast.error("지갑을 연결하세요");
    if (chainId !== CHAIN_ID)
      return toast.error("지갑 네트워크를 Xphere로 전환하세요");
    if (n0 <= 0 || n1 <= 0) return toast.error("두 토큰 수량을 입력하세요");
    if (!enough) return toast.error("잔액이 부족합니다");

    const addrA = liquidityTokenAddress(pool.token0, tokenMap);
    const addrB = liquidityTokenAddress(pool.token1, tokenMap);
    if (!addrA || !addrB)
      return toast.error("이 풀의 토큰에 컨트랙트 주소가 없습니다");

    try {
      setSupplying(true);
      const amtA = parseUnits(amount0, tA.decimals);
      const amtB = parseUnits(amount1, tB.decimals);
      // First deposit sets the price exactly — no slippage needed.
      const minA = hasReserves
        ? applySlippage(amtA, LIQUIDITY_SLIPPAGE_PCT)
        : amtA;
      const minB = hasReserves
        ? applySlippage(amtB, LIQUIDITY_SLIPPAGE_PCT)
        : amtB;
      const deadline = liquidityDeadline();

      const aIsBnb = pool.token0 === NATIVE_SYMBOL;
      const bIsBnb = pool.token1 === NATIVE_SYMBOL;

      if (!aIsBnb) await ensureAllowance(addrA, amtA, pool.token0);
      if (!bIsBnb) await ensureAllowance(addrB, amtB, pool.token1);

      toast.info("유동성 공급 트랜잭션 전송 중… 지갑에서 확인하세요");
      let hash: `0x${string}`;
      if (aIsBnb || bIsBnb) {
        const tokenAddr = aIsBnb ? addrB : addrA;
        const amtToken = aIsBnb ? amtB : amtA;
        const minToken = aIsBnb ? minB : minA;
        const amtBnb = aIsBnb ? amtA : amtB;
        const minBnb = aIsBnb ? minA : minB;
        hash = await writeContractAsync({
          address: PANCAKE_ROUTER,
          abi: LIQUIDITY_ROUTER_ABI,
          functionName: "addLiquidityETH",
          args: [tokenAddr, amtToken, minToken, minBnb, wallet, deadline],
          value: amtBnb,
          chainId: CHAIN_ID,
        });
      } else {
        hash = await writeContractAsync({
          address: PANCAKE_ROUTER,
          abi: LIQUIDITY_ROUTER_ABI,
          functionName: "addLiquidity",
          args: [addrA, addrB, amtA, amtB, minA, minB, wallet, deadline],
          chainId: CHAIN_ID,
        });
      }
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        return toast.error("유동성 공급 트랜잭션 실패");

      const summary = `Added ${formatNumber(n0, 4)} ${pool.token0} + ${formatNumber(n1, 4)} ${pool.token1} liquidity`;
      recordTransaction("add-liquidity", summary);
      toast.success(
        `유동성 공급 완료 — ${pool.token0}/${pool.token1} LP 토큰을 받았습니다`,
      );
      setAmount0("");
      setAmount1("");
      onClose();
    } catch {
      toast.error("유동성 공급 실패 — 지갑 거부 / 잔액 부족 등을 확인하세요");
    } finally {
      setSupplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/40 p-4 pt-24">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Add liquidity to ${pool.token0} / ${pool.token1}`}
        className="animate-fade-in relative w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
      >
        <div className="flex items-center justify-between p-5">
          <div className="flex items-center gap-2">
            <TokenLogo symbol={pool.token0} size={28} />
            <TokenLogo symbol={pool.token1} size={28} />
            <h3 className="ml-1 text-base font-semibold">
              {pool.token0} / {pool.token1}
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
          {/* Pool meta + total + USD presets */}
          <div className="rounded-2xl bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between text-xs text-[var(--muted)]">
              <span>Deposit by token amount</span>
              <span>{pool.feeTier}% fee</span>
            </div>
            <div className="mt-1 text-2xl font-semibold">
              {formatUsd(total)}{" "}
              <span className="text-sm font-normal text-[var(--muted)]">
                total
              </span>
            </div>
            <div className="mt-2 flex gap-2">
              {[100, 500, 1000].map((v) => (
                <button
                  key={v}
                  onClick={() => setTotalUsd(v)}
                  className="rounded-lg bg-[var(--card)] px-2.5 py-1 text-xs font-medium text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                >
                  ${v}
                </button>
              ))}
            </div>
          </div>

          {/* Editable token amounts — ratio-synced once the pair has reserves */}
          <div className="mt-3 space-y-2">
            <AmountRow
              symbol={pool.token0}
              value={amount0}
              onChange={onChange0}
              onMax={setMax0}
              balance={bal0}
              usd={usd0}
            />
            <div className="flex justify-center">
              <Plus className="h-4 w-4 text-[var(--muted-2)]" />
            </div>
            <AmountRow
              symbol={pool.token1}
              value={amount1}
              onChange={onChange1}
              onMax={setMax1}
              balance={bal1}
              usd={usd1}
            />
          </div>

          {hasReserves ? (
            <p className="mt-3 text-center text-xs text-[var(--muted-2)]">
              1 {pool.token0} = {formatNumber(ratio01, 6)} {pool.token1} (온체인
              비율)
            </p>
          ) : (
            <p className="mt-3 text-center text-xs text-[var(--accent)]">
              첫 유동성 공급 — 입력한 두 수량의 비율이 이 풀의 초기 가격이
              됩니다
            </p>
          )}

          <div className="mt-4">
            {!hydrated ? (
              <div className="h-12 w-full rounded-2xl bg-[var(--surface-2)] animate-pulse-soft" />
            ) : !connected ? (
              <button
                onClick={() => openWalletModal()}
                className="h-12 w-full rounded-2xl bg-[var(--accent)] font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
              >
                Connect Wallet
              </button>
            ) : (
              <button
                onClick={supply}
                disabled={supplying || n0 <= 0 || n1 <= 0 || !enough}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--muted-2)]"
              >
                {supplying && <Loader2 className="h-4 w-4 animate-spin" />}
                {supplying
                  ? "공급 중…"
                  : n0 <= 0 || n1 <= 0
                    ? "Enter an amount"
                    : !enough
                      ? "Insufficient balance"
                      : "Add Liquidity"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AmountRow({
  symbol,
  value,
  onChange,
  onMax,
  balance,
  usd,
}: {
  symbol: string;
  value: string;
  onChange: (v: string) => void;
  onMax: () => void;
  balance: number;
  usd: number;
}) {
  const short = (parseFloat(value) || 0) > balance;
  return (
    <div className="rounded-2xl border border-[var(--border)] px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <TokenLogo symbol={symbol} size={32} />
          <div className="text-sm font-semibold">{symbol}</div>
        </div>
        <input
          type="text"
          inputMode="decimal"
          value={formatAmountInput(value)}
          onChange={(e) => onChange(parseAmountInput(e.target.value))}
          placeholder="0"
          aria-label={`${symbol} amount`}
          className="w-1/2 bg-transparent text-right text-lg font-semibold outline-none placeholder:text-[var(--muted-2)]"
          style={{ color: short ? "var(--down)" : undefined }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-[var(--muted)]">
        <button
          onClick={onMax}
          className="transition-colors hover:text-[var(--foreground)]"
        >
          Balance: {formatNumber(balance, 4)}{" "}
          <span className="font-medium text-[var(--accent)]">MAX</span>
        </button>
        <span>{formatUsd(usd)}</span>
      </div>
    </div>
  );
}
