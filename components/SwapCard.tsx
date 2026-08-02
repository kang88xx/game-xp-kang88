"use client";

import { useState } from "react";
import { ArrowDown, ChevronDown, Loader2, Settings2 } from "lucide-react";
import { useAppKit } from "@reown/appkit/react";
import { erc20Abi, maxUint256 } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { useDexStore, useHydrated } from "@/lib/store";
import { useBalance } from "@/lib/balances";
import { useMarket } from "@/lib/market";
import { useTokenRegistry, tokenTradable } from "@/lib/token-registry";
import {
  applySlippage,
  MAX_SLIPPAGE_PCT,
  PANCAKE_FEE,
  PANCAKE_ROUTER,
  PANCAKE_ROUTER_ABI,
  swapDeadline,
  useSwapQuote,
} from "@/lib/pancake";
import { CHAIN_ID, CHAIN_LABEL, NATIVE_SYMBOL } from "@/lib/chain";
import { formatNumber, formatUsd, formatAmountInput, parseAmountInput } from "@/lib/format";
import { TokenLogo } from "./TokenLogo";
import { TokenSelectModal } from "./TokenSelectModal";
import { toast } from "./toast";
import { ArrowChip } from "./ui";

const XPHERE_CHAIN_ID = CHAIN_ID;
// Keep a little XP aside for gas when pressing MAX
const GAS_RESERVE = 0.005;

export interface SwapPair {
  from: string;
  to: string;
}

export function SwapCard({
  pair,
  onPairChange,
}: {
  /** Controlled token pair — pass with onPairChange to drive it externally. */
  pair?: SwapPair;
  onPairChange?: (pair: SwapPair) => void;
} = {}) {
  const hydrated = useHydrated();
  const connected = useDexStore((s) => s.connected);
  const recordTransaction = useDexStore((s) => s.recordTransaction);
  const { open: openWalletModal } = useAppKit();
  const market = useMarket();
  const queryClient = useQueryClient();

  const { address, chainId } = useAccount();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [localPair, setLocalPair] = useState<SwapPair>({
    from: NATIVE_SYMBOL,
    to: "USDX",
  });
  const { from, to } = pair ?? localPair;
  const setPair = (next: SwapPair) => {
    onPairChange?.(next);
    if (!pair) setLocalPair(next);
  };
  const [amount, setAmount] = useState("");
  const [picker, setPicker] = useState<null | "from" | "to">(null);
  const [slippage, setSlippage] = useState(1);
  const [customSlippage, setCustomSlippage] = useState(false);
  const [customText, setCustomText] = useState("5");
  const [showSettings, setShowSettings] = useState(false);

  // tx lifecycle: an in-flight approve or swap, resolved by its receipt
  const [pendingAction, setPendingAction] = useState<null | "approve" | "swap">(
    null,
  );

  const { map: tokenMap } = useTokenRegistry();
  const fromToken = tokenMap[from];
  const isFromNative = from === NATIVE_SYMBOL;
  const fromBal = useBalance(from);
  const pFrom = market[from]?.priceUsd ?? 0;
  const pTo = market[to]?.priceUsd ?? 0;

  const amountNum = parseFloat(amount) || 0;

  // Real PancakeSwap quote (works without a connected wallet)
  const quote = useSwapQuote(from, to, amount);
  const amountOut = quote.amountOut;
  const rate =
    amountNum > 0 && amountOut > 0
      ? amountOut / amountNum
      : pTo > 0
        ? pFrom / pTo
        : 0;
  const minOutWei = applySlippage(quote.amountOutWei, slippage);
  const minReceived = amountOut * (1 - slippage / 100);

  const insufficient = hydrated && connected && amountNum > fromBal;
  const wrongChain =
    connected && chainId !== undefined && chainId !== XPHERE_CHAIN_ID;
  const untradableSide = !tokenTradable(tokenMap[from])
    ? from
    : !tokenTradable(tokenMap[to])
      ? to
      : null;

  // Router allowance for ERC-20 inputs (native XP needs none)
  const { data: allowance } = useReadContract({
    address: (fromToken?.address ?? undefined) as `0x${string}` | undefined,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, PANCAKE_ROUTER] : undefined,
    query: { enabled: !!address && !isFromNative && !!fromToken?.address },
  });
  const needsApproval =
    !isFromNative &&
    quote.amountInWei > 0n &&
    allowance !== undefined &&
    allowance < quote.amountInWei;

  /** Await the receipt, then surface the result and refresh wagmi queries. */
  const settleTx = async (
    hash: `0x${string}`,
    onSuccess: () => void,
  ): Promise<void> => {
    if (!publicClient) return;
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "success") {
      onSuccess();
      // refresh balances + allowance right away
      queryClient.invalidateQueries();
    } else {
      toast.error("Transaction failed on-chain");
    }
  };

  const switchTokens = () => {
    setPair({ from: to, to: from });
    setAmount("");
  };

  const pick = (symbol: string) => {
    if (picker === "from") {
      setPair({ from: symbol, to: symbol === to ? from : to });
    } else if (picker === "to") {
      setPair({ from: symbol === from ? to : from, to: symbol });
    }
  };

  const setMax = () => {
    const max = isFromNative
      ? Math.max(0, fromBal - GAS_RESERVE)
      : fromBal;
    setAmount(String(Number(max.toFixed(6))));
  };

  const handleSwitchChain = async () => {
    try {
      await switchChainAsync({ chainId: XPHERE_CHAIN_ID });
    } catch {
      toast.error("Network switch rejected");
    }
  };

  // One-click trade: approve the input token if needed, then go straight to
  // the swap in the same flow — no second click. Every early exit surfaces a
  // toast so a click never silently does nothing.
  const handleSwap = async () => {
    if (!address) return toast.error("Connect your wallet");
    if (!publicClient) return toast.error("Check your network connection");
    if (quote.noRoute || quote.path.length === 0)
      return toast.error("No liquidity route for this token pair");
    // W1: never submit a swap whose slippage-adjusted minimum rounds to 0,
    // which would leave the trade with no on-chain output protection.
    if (quote.amountOutWei <= 0n || minOutWei <= 0n)
      return toast.error("Fetching quote — please try again shortly");

    const deadline = swapDeadline();
    const summary = `Swapped ${formatNumber(amountNum, 4)} ${from} → ${formatNumber(amountOut, 4)} ${to}`;
    // Local stage flag: state set inside this async fn won't update the
    // closure's `pendingAction`, so track the failing step ourselves.
    let stage: "approve" | "swap" = "swap";
    try {
      // Step 1 — approve the ERC-20 input for the router (native XP needs none).
      if (needsApproval && fromToken?.address) {
        stage = "approve";
        setPendingAction("approve");
        toast.info(`Approving ${from}… confirm in your wallet`);
        const approveHash = await writeContractAsync({
          address: fromToken.address as `0x${string}`,
          abi: erc20Abi,
          functionName: "approve",
          args: [PANCAKE_ROUTER, maxUint256],
          chainId: XPHERE_CHAIN_ID,
        });
        const aReceipt = await publicClient.waitForTransactionReceipt({
          hash: approveHash,
        });
        if (aReceipt.status !== "success")
          return toast.error(`${from} approval transaction failed`);
      }

      // Step 2 — the swap itself.
      stage = "swap";
      setPendingAction("swap");
      toast.info("Sending swap transaction… confirm in your wallet");
      let hash: `0x${string}`;
      if (isFromNative) {
        hash = await writeContractAsync({
          address: PANCAKE_ROUTER,
          abi: PANCAKE_ROUTER_ABI,
          functionName: "swapExactETHForTokens",
          args: [minOutWei, quote.path, address, deadline],
          value: quote.amountInWei,
          chainId: XPHERE_CHAIN_ID,
        });
      } else if (to === NATIVE_SYMBOL) {
        hash = await writeContractAsync({
          address: PANCAKE_ROUTER,
          abi: PANCAKE_ROUTER_ABI,
          functionName: "swapExactTokensForETH",
          args: [quote.amountInWei, minOutWei, quote.path, address, deadline],
          chainId: XPHERE_CHAIN_ID,
        });
      } else {
        hash = await writeContractAsync({
          address: PANCAKE_ROUTER,
          abi: PANCAKE_ROUTER_ABI,
          functionName: "swapExactTokensForTokens",
          args: [quote.amountInWei, minOutWei, quote.path, address, deadline],
          chainId: XPHERE_CHAIN_ID,
        });
      }
      await settleTx(hash, () => {
        toast.success(summary);
        recordTransaction("swap", summary);
        // Report the swap for analytics + per-pool Fee APR (best-effort). The
        // server re-derives USD volume and the pair from this tx's on-chain
        // Swap logs — we send only the hash, never a self-reported amount
        // (which the server no longer trusts).
        fetch("/api/analytics", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ event: "swap", txHash: hash }),
        }).catch(() => {});
        setAmount("");
      });
    } catch {
      toast.error(
        stage === "approve"
          ? "Approval rejected or failed"
          : "Swap rejected or failed",
      );
    } finally {
      setPendingAction(null);
      // Refresh the router allowance so the button reflects the new state.
      queryClient.invalidateQueries();
    }
  };

  const busy = pendingAction !== null || isSwitching;
  const swapDisabled =
    busy ||
    amountNum <= 0 ||
    insufficient ||
    untradableSide !== null ||
    quote.noRoute ||
    quote.isLoading || // W3: don't act on a quote that is still resolving
    quote.amountOutWei <= 0n ||
    minOutWei <= 0n; // W1: one-click approve+swap always needs a live quote

  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-xl shadow-black/[0.03]">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-base font-semibold">Swap</h2>
        <div className="relative">
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--surface)]"
          >
            <Settings2 className="h-4 w-4" />
          </button>
          {showSettings && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setShowSettings(false)}
              />
              <div className="animate-fade-in absolute right-0 top-10 z-40 w-64 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-xl">
                <p className="text-sm font-medium">Slippage tolerance</p>
                <div className="mt-3 flex gap-2">
                  {[0.2, 1, 3].map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setCustomSlippage(false);
                        setSlippage(s);
                      }}
                      className={`flex-1 rounded-xl px-2 py-1.5 text-sm transition-colors ${
                        !customSlippage && slippage === s
                          ? "bg-[var(--accent)] text-white"
                          : "bg-[var(--surface-2)] text-[var(--muted)]"
                      }`}
                    >
                      {s}%
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      setCustomSlippage(true);
                      setCustomText("5");
                      setSlippage(5);
                    }}
                    className={`flex-1 rounded-xl px-2 py-1.5 text-sm transition-colors ${
                      customSlippage
                        ? "bg-[var(--accent)] text-white"
                        : "bg-[var(--surface-2)] text-[var(--muted)]"
                    }`}
                  >
                    Custom
                  </button>
                </div>
                {customSlippage && (
                  <div className="mt-2 flex items-center gap-2 rounded-xl bg-[var(--surface-2)] px-3 py-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      autoFocus
                      value={customText}
                      onChange={(e) => {
                        setCustomText(e.target.value);
                        const v = parseFloat(e.target.value);
                        setSlippage(
                          Number.isFinite(v)
                            ? Math.min(Math.max(v, 0), MAX_SLIPPAGE_PCT)
                            : 0,
                        );
                      }}
                      placeholder="0"
                      className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted-2)]"
                    />
                    <span className="text-sm text-[var(--muted)]">%</span>
                  </div>
                )}
                {slippage > 5 && (
                  <p className="mt-2 text-xs text-[var(--down)]">
                    High slippage — you may get an unfavorable price or be exposed to MEV
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* From */}
      <div className="rounded-2xl bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between text-xs text-[var(--muted)]">
          <span>Sell</span>
          {hydrated && connected && (
            <button
              onClick={setMax}
              className="transition-colors hover:text-[var(--foreground)]"
            >
              Balance: {formatNumber(fromBal, 4)}{" "}
              <span className="font-medium text-[var(--accent)]">MAX</span>
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <input
            type="text"
            inputMode="decimal"
            value={formatAmountInput(amount)}
            onChange={(e) => setAmount(parseAmountInput(e.target.value))}
            placeholder="0"
            className="w-full bg-transparent text-3xl font-semibold outline-none placeholder:text-[var(--muted-2)]"
          />
          <TokenPickerButton symbol={from} onClick={() => setPicker("from")} />
        </div>
        <div className="mt-1 text-sm text-[var(--muted)]">
          {formatUsd(amountNum * pFrom)}
        </div>
      </div>

      {/* Switch */}
      <div className="relative z-10 -my-3 flex justify-center">
        <button
          onClick={switchTokens}
          className="flex h-9 w-9 items-center justify-center rounded-xl border-4 border-[var(--card)] bg-[var(--surface-2)] text-[var(--foreground)] transition-colors hover:bg-[var(--border)]"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      </div>

      {/* To */}
      <div className="rounded-2xl bg-[var(--surface)] p-4">
        <span className="text-xs text-[var(--muted)]">Buy</span>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="w-full truncate text-3xl font-semibold text-[var(--foreground)]">
            {quote.isLoading && amountOut === 0 && amountNum > 0
              ? "…"
              : amountOut > 0
                ? formatNumber(amountOut, 6)
                : "0"}
          </span>
          <TokenPickerButton symbol={to} onClick={() => setPicker("to")} />
        </div>
        <div className="mt-1 text-sm text-[var(--muted)]">
          {formatUsd(amountOut * pTo)}
        </div>
      </div>

      {/* Details */}
      {amountNum > 0 && (
        <div className="mt-2 space-y-1.5 rounded-2xl px-4 py-3 text-xs">
          <Row label="Rate">
            1 {from} = {formatNumber(rate, 6)} {to}
          </Row>
          <Row label={`LP fee (${PANCAKE_FEE * 100}%)`}>
            {formatUsd(amountNum * pFrom * PANCAKE_FEE)}
          </Row>
          <Row label={`Min. received (${slippage}% slippage)`}>
            {formatNumber(minReceived, 6)} {to}
          </Row>
          {quote.path.length === 3 && (
            <Row label="Route">
              {from} → XP → {to}
            </Row>
          )}
        </div>
      )}

      {/* Action */}
      <div className="p-2 pt-1">
        {!hydrated ? (
          <div className="h-14 w-full rounded-2xl bg-[var(--surface-2)] animate-pulse-soft" />
        ) : !connected ? (
          <button
            onClick={() => openWalletModal()}
            className="flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-[var(--accent)] text-base font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
          >
            Connect Wallet
            <ArrowChip variant="onAccent" />
          </button>
        ) : wrongChain ? (
          <button
            onClick={handleSwitchChain}
            disabled={isSwitching}
            className="flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-[var(--accent)] text-base font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSwitching ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Switching…
              </>
            ) : (
              `Switch to ${CHAIN_LABEL}`
            )}
          </button>
        ) : (
          <button
            disabled={swapDisabled}
            onClick={handleSwap}
            className="flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-[var(--accent)] text-base font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--muted-2)]"
          >
            {busy ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                {pendingAction === "approve" ? "Approving…" : "Swapping…"}
              </>
            ) : untradableSide ? (
              `${untradableSide} not tradable yet`
            ) : amountNum <= 0 ? (
              "Enter an amount"
            ) : insufficient ? (
              `Insufficient ${from}`
            ) : quote.noRoute ? (
              "No liquidity route"
            ) : quote.isLoading && quote.amountOutWei === 0n ? (
              "Fetching quote…"
            ) : needsApproval ? (
              <>
                Approve &amp; Swap
                <ArrowChip variant="onAccent" />
              </>
            ) : (
              <>
                Swap
                <ArrowChip variant="onAccent" />
              </>
            )}
          </button>
        )}
      </div>

      <TokenSelectModal
        open={picker !== null}
        onClose={() => setPicker(null)}
        onSelect={pick}
        exclude={picker === "from" ? to : from}
        tradableOnly
      />
    </div>
  );
}

function TokenPickerButton({
  symbol,
  onClick,
}: {
  symbol: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex shrink-0 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] py-1.5 pl-1.5 pr-3 font-semibold shadow-sm transition-colors hover:bg-[var(--surface)]"
    >
      <TokenLogo symbol={symbol} size={26} />
      {symbol}
      <ChevronDown className="h-4 w-4 text-[var(--muted)]" />
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}
