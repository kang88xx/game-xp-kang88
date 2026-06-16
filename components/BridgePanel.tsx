"use client";

// Working testnet bridge UI: lock USDT on the source chain, then hand the
// tx hash to /api/bridge whose relayer releases on the destination chain.
// One click drives the whole flow (switch network → approve → lock → relay),
// mirroring the one-click swap UX.
import { useState } from "react";
import { ArrowDownUp, Check, ExternalLink, Loader2 } from "lucide-react";
import { erc20Abi, formatUnits, maxUint256, parseUnits } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { useQueryClient } from "@tanstack/react-query";
import { useDexStore, useHydrated } from "@/lib/store";
import {
  BRIDGE_SIDES,
  BRIDGE_TOKEN_DECIMALS,
  BRIDGE_TOKEN_SYMBOL,
  BSC_TESTNET_ID,
  OPBNB_TESTNET_ID,
  TEST_BRIDGE_ABI,
  otherSide,
} from "@/lib/bridge";
import { formatNumber, formatAmountInput, parseAmountInput } from "@/lib/format";
import { toast } from "@/components/toast";
import { TokenLogo } from "./TokenLogo";

type Step = "approve" | "lock" | "relay";
type Phase = { step: Step; status: "active" | "done" } | null;

const STEP_LABEL: Record<Step, string> = {
  approve: "USDT 승인",
  lock: "소스 체인에 잠금",
  relay: "목적지 체인에서 지급",
};

export function BridgePanel() {
  const hydrated = useHydrated();
  const connected = useDexStore((s) => s.connected);
  const recordTransaction = useDexStore((s) => s.recordTransaction);
  const { open: openWalletModal } = useAppKit();
  const { address, chainId: walletChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();

  const [srcChainId, setSrcChainId] = useState<number>(BSC_TESTNET_ID);
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>(null);
  const [doneTx, setDoneTx] = useState<{ chainId: number; hash: string } | null>(
    null,
  );

  const src = BRIDGE_SIDES[srcChainId];
  const dst = otherSide(srcChainId);
  const srcPublic = usePublicClient({ chainId: src.chainId });

  // Balances on both sides + what the destination can actually pay out.
  const { data: srcBal } = useReadContract({
    address: src.usdt as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: src.chainId,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
  const { data: dstBal } = useReadContract({
    address: dst.usdt as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: dst.chainId,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
  const { data: dstReserve } = useReadContract({
    address: dst.bridge as `0x${string}`,
    abi: TEST_BRIDGE_ABI,
    functionName: "reserve",
    chainId: dst.chainId,
    query: { refetchInterval: 30_000 },
  });
  const { data: allowance } = useReadContract({
    address: src.usdt as `0x${string}`,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, src.bridge as `0x${string}`] : undefined,
    chainId: src.chainId,
    query: { enabled: !!address },
  });

  const fmt = (v: bigint | undefined) =>
    v === undefined ? "—" : formatNumber(Number(formatUnits(v, BRIDGE_TOKEN_DECIMALS)), 4);

  const amountNum = parseFloat(amount) || 0;
  let amountWei = 0n;
  try {
    if (amountNum > 0) amountWei = parseUnits(amount, BRIDGE_TOKEN_DECIMALS);
  } catch {
    amountWei = 0n;
  }

  const insufficient =
    srcBal !== undefined && amountWei > 0n && amountWei > srcBal;
  const overReserve =
    dstReserve !== undefined && amountWei > 0n && amountWei > dstReserve;
  const busy = phase !== null;
  const disabled =
    busy || amountWei <= 0n || insufficient || overReserve || !hydrated;

  const flip = () => {
    setSrcChainId(dst.chainId);
    setDoneTx(null);
  };
  const setMax = () =>
    srcBal !== undefined &&
    setAmount(formatUnits(srcBal, BRIDGE_TOKEN_DECIMALS));

  const bridge = async () => {
    if (!address) return toast.error("지갑을 연결하세요");
    if (!srcPublic) return toast.error("네트워크 연결을 확인하세요");
    setDoneTx(null);
    try {
      // 0) Wallet must be on the source chain.
      if (walletChainId !== src.chainId) {
        toast.info(`${src.short}로 네트워크 전환 중…`);
        await switchChainAsync({ chainId: src.chainId });
      }

      // 1) Approve the bridge for USDT if allowance is short.
      if (allowance === undefined || allowance < amountWei) {
        setPhase({ step: "approve", status: "active" });
        toast.info("USDT 사용 승인 중… 지갑에서 확인하세요");
        const approveHash = await writeContractAsync({
          address: src.usdt as `0x${string}`,
          abi: erc20Abi,
          functionName: "approve",
          args: [src.bridge as `0x${string}`, maxUint256],
          chainId: src.chainId,
        });
        const r = await srcPublic.waitForTransactionReceipt({
          hash: approveHash,
        });
        if (r.status !== "success") throw new Error("approve reverted");
      }

      // 2) Lock on the source chain.
      setPhase({ step: "lock", status: "active" });
      toast.info("브릿지 트랜잭션 전송 중… 지갑에서 확인하세요");
      const lockHash = await writeContractAsync({
        address: src.bridge as `0x${string}`,
        abi: TEST_BRIDGE_ABI,
        functionName: "bridgeOut",
        args: [amountWei, BigInt(dst.chainId)],
        chainId: src.chainId,
      });
      const lockReceipt = await srcPublic.waitForTransactionReceipt({
        hash: lockHash,
      });
      if (lockReceipt.status !== "success")
        throw new Error("bridge tx reverted");

      // 3) Ask the relayer to release on the destination chain.
      setPhase({ step: "relay", status: "active" });
      const res = await fetch("/api/bridge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ srcChainId: src.chainId, txHash: lockHash }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        dstTxHash?: string;
        alreadyProcessed?: boolean;
      };
      if (!data.ok)
        throw new Error(data.error ?? "릴레이어 처리에 실패했습니다");

      setPhase({ step: "relay", status: "done" });
      if (data.dstTxHash)
        setDoneTx({ chainId: dst.chainId, hash: data.dstTxHash });
      const summary = `Bridged ${formatNumber(amountNum, 4)} USDT ${src.short} → ${dst.short}`;
      recordTransaction("bridge", summary);
      toast.success(summary);
      setAmount("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      toast.error(
        msg.includes("User rejected") || msg.includes("rejected")
          ? "지갑에서 거부되었습니다"
          : `브릿지 실패 — ${msg.slice(0, 120) || "다시 시도하세요"}`,
      );
    } finally {
      setPhase((p) => (p?.status === "done" ? p : null));
      queryClient.invalidateQueries();
    }
  };

  const activeStep = phase?.status === "active" ? phase.step : null;

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-xl shadow-black/[0.03]">
        <div className="px-3 py-2">
          <h2 className="text-base font-semibold">Bridge USDT</h2>
          <p className="text-xs text-[var(--muted)]">
            {src.short} → {dst.short} · 테스트넷 전용
          </p>
        </div>

        {/* From */}
        <ChainBox
          title="From"
          side={src}
          balance={fmt(srcBal)}
          onMax={setMax}
        >
          <input
            type="text"
            inputMode="decimal"
            value={formatAmountInput(amount)}
            onChange={(e) => setAmount(parseAmountInput(e.target.value))}
            placeholder="0"
            className="w-full bg-transparent text-3xl font-semibold outline-none placeholder:text-[var(--muted-2)]"
          />
        </ChainBox>

        {/* Flip */}
        <div className="relative z-10 -my-3 flex justify-center">
          <button
            onClick={flip}
            disabled={busy}
            aria-label="방향 전환"
            className="flex h-9 w-9 items-center justify-center rounded-xl border-4 border-[var(--card)] bg-[var(--surface-2)] text-[var(--muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
          >
            <ArrowDownUp className="h-4 w-4" />
          </button>
        </div>

        {/* To */}
        <ChainBox title="To" side={dst} balance={fmt(dstBal)}>
          <div className="text-3xl font-semibold text-[var(--foreground)]">
            {amountNum > 0 ? formatNumber(amountNum, 6) : "0"}
          </div>
        </ChainBox>

        {/* Details */}
        <div className="space-y-1.5 rounded-2xl px-4 py-3 text-xs">
          <div className="flex justify-between text-[var(--muted)]">
            <span>브릿지 수수료</span>
            <span>없음 (1:1 지급)</span>
          </div>
          <div className="flex justify-between text-[var(--muted)]">
            <span>{dst.short} 지급 가능량</span>
            <span>
              {fmt(dstReserve)} {BRIDGE_TOKEN_SYMBOL}
            </span>
          </div>
          {srcChainId === OPBNB_TESTNET_ID && (
            <p className="pt-1 text-[var(--muted-2)]">
              opBNB 테스트넷 가스(tBNB)가 필요합니다 —{" "}
              <a
                href="https://opbnb-testnet-bridge.bnbchain.org/deposit"
                target="_blank"
                rel="noreferrer"
                className="text-[var(--accent)] underline"
              >
                공식 브릿지로 받기
              </a>
            </p>
          )}
        </div>

        {/* Progress */}
        {(phase || doneTx) && (
          <div className="mx-2 mb-1 space-y-2 rounded-2xl bg-[var(--surface)] p-4">
            {(["approve", "lock", "relay"] as Step[]).map((s) => {
              const order: Step[] = ["approve", "lock", "relay"];
              const cur = phase ? order.indexOf(phase.step) : 3;
              const idx = order.indexOf(s);
              const done =
                idx < cur || (idx === cur && phase?.status === "done");
              const active = activeStep === s;
              return (
                <div key={s} className="flex items-center gap-2.5 text-sm">
                  {done ? (
                    <Check className="h-4 w-4 text-[var(--up)]" />
                  ) : active ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
                  ) : (
                    <span className="h-4 w-4 rounded-full border border-[var(--border)]" />
                  )}
                  <span
                    className={
                      done || active
                        ? "text-[var(--foreground)]"
                        : "text-[var(--muted-2)]"
                    }
                  >
                    {STEP_LABEL[s]}
                  </span>
                </div>
              );
            })}
            {doneTx && (
              <a
                href={`${BRIDGE_SIDES[doneTx.chainId].explorer}/tx/${doneTx.hash}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)]"
              >
                도착 트랜잭션 보기 <ExternalLink className="h-3 w-3" />
              </a>
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
              className="h-14 w-full rounded-2xl bg-[var(--accent)] text-base font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
            >
              Connect Wallet
            </button>
          ) : (
            <button
              disabled={disabled}
              onClick={bridge}
              className="flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-[var(--accent)] text-base font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--muted-2)]"
            >
              {busy ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {activeStep ? STEP_LABEL[activeStep] + "…" : "처리 중…"}
                </>
              ) : amountNum <= 0 ? (
                "Enter an amount"
              ) : insufficient ? (
                `Insufficient ${BRIDGE_TOKEN_SYMBOL}`
              ) : overReserve ? (
                "지급 가능량 초과"
              ) : (
                `Bridge to ${dst.short}`
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ChainBox({
  title,
  side,
  balance,
  onMax,
  children,
}: {
  title: string;
  side: { short: string };
  balance: string;
  onMax?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between text-xs text-[var(--muted)]">
        <span>
          {title} · {side.short}
        </span>
        {onMax ? (
          <button
            onClick={onMax}
            className="transition-colors hover:text-[var(--foreground)]"
          >
            Balance: {balance}{" "}
            <span className="font-medium text-[var(--accent)]">MAX</span>
          </button>
        ) : (
          <span>Balance: {balance}</span>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        {children}
        <div className="flex shrink-0 items-center gap-2 rounded-full bg-[var(--card)] py-1.5 pl-1.5 pr-3">
          <TokenLogo symbol="USDT" size={24} />
          <span className="text-sm font-semibold">USDT</span>
        </div>
      </div>
    </div>
  );
}
