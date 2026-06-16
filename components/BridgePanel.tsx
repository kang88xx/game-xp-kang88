"use client";

// Functional Xphere <-> BSC bridge over the public XPBridge zk-bridge.
// approve -> initiateBridge(token, amount, destChainId, recipient); the
// XPBridge relayer releases the paired token on the destination chain.
import { useState } from "react";
import { ArrowDownUp, Loader2, ExternalLink } from "lucide-react";
import { erc20Abi, formatUnits, parseUnits, isAddress } from "viem";
import {
  useAccount,
  useReadContracts,
  useSwitchChain,
  useWriteContract,
  usePublicClient,
} from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import {
  BRIDGE_ABI,
  BRIDGE_CHAINS,
  BRIDGE_ENABLED,
  XPHERE_CHAIN_ID,
  bridgeTokensForChain,
  otherChainId,
  bridgeFeePercent,
} from "@/lib/bridge";
import { formatAmountInput, parseAmountInput, formatNumber } from "@/lib/format";
import { TokenLogo } from "./TokenLogo";
import { toast } from "./toast";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

interface TokenInfo {
  supported: boolean;
  decimals: number;
  minAmount: bigint;
  maxAmount: bigint;
  dailyLimit: bigint;
  dailyUsage: bigint;
  lastResetDay: bigint;
}

export function BridgePanel() {
  const { address, chainId, isConnected } = useAccount();
  const { open } = useAppKit();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [sourceId, setSourceId] = useState<number>(XPHERE_CHAIN_ID);
  const destId = otherChainId(sourceId);
  const tokens = bridgeTokensForChain(sourceId);
  const [tokenKey, setTokenKey] = useState(tokens[0]?.key ?? "");
  const token = tokens.find((t) => t.key === tokenKey) ?? tokens[0];

  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);

  const src = BRIDGE_CHAINS[sourceId];
  const dst = BRIDGE_CHAINS[destId];
  const srcTok = token?.chains[sourceId];
  const dstTok = token?.chains[destId];
  const decimals = srcTok?.decimals ?? 18;
  const bridgeAddr = src.bridge;
  const tokenAddr = srcTok?.address;
  const publicClient = usePublicClient({ chainId: sourceId });

  const { data: reads } = useReadContracts({
    allowFailure: true,
    contracts: tokenAddr
      ? [
          { address: bridgeAddr, abi: BRIDGE_ABI, functionName: "bridgeFee", chainId: sourceId },
          { address: bridgeAddr, abi: BRIDGE_ABI, functionName: "getTokenInfo", args: [tokenAddr], chainId: sourceId },
          { address: bridgeAddr, abi: BRIDGE_ABI, functionName: "getRemainingDailyLimit", args: [tokenAddr], chainId: sourceId },
          { address: tokenAddr, abi: erc20Abi, functionName: "balanceOf", args: [address ?? ZERO], chainId: sourceId },
          { address: tokenAddr, abi: erc20Abi, functionName: "allowance", args: [address ?? ZERO, bridgeAddr], chainId: sourceId },
        ]
      : [],
    query: { enabled: !!tokenAddr, refetchInterval: 20_000 },
  });

  const feeRaw = reads?.[0]?.result as bigint | undefined;
  const info = reads?.[1]?.result as TokenInfo | undefined;
  const remainingRaw = reads?.[2]?.result as bigint | undefined;
  const balanceRaw = (reads?.[3]?.result as bigint | undefined) ?? 0n;
  const allowanceRaw = (reads?.[4]?.result as bigint | undefined) ?? 0n;

  const feePercent = bridgeFeePercent(feeRaw);
  const amountNum = parseFloat(amount) || 0;
  const feeAmount = amountNum * (feePercent / 100);
  const receiveAmount = Math.max(0, amountNum - feeAmount);

  const minN = info ? Number(formatUnits(info.minAmount, decimals)) : 0;
  const maxN = info ? Number(formatUnits(info.maxAmount, decimals)) : 0;
  const dailyLimitN = info ? Number(formatUnits(info.dailyLimit, decimals)) : 0;
  const dailyUsedN = info ? Number(formatUnits(info.dailyUsage, decimals)) : 0;
  const remainingN =
    remainingRaw !== undefined
      ? Number(formatUnits(remainingRaw, decimals))
      : Math.max(0, dailyLimitN - dailyUsedN);
  const balanceN = Number(formatUnits(balanceRaw, decimals));

  // Plain computed value — the React Compiler handles memoization; a manual
  // useMemo here trips react-hooks/preserve-manual-memoization.
  const error: string | null = (() => {
    if (!token || !srcTok) return "No supported bridge tokens available";
    if (amountNum <= 0) return null;
    if (info && !info.supported) return "This token is not supported by the bridge";
    if (minN && amountNum < minN) return `Min ${formatNumber(minN)} ${srcTok.symbol}`;
    if (maxN && amountNum > maxN) return `Max ${formatNumber(maxN)} ${srcTok.symbol}`;
    if (amountNum > remainingN) return `Daily limit exceeded (remaining ${formatNumber(remainingN)})`;
    if (amountNum > balanceN) return "Insufficient balance";
    return null;
  })();

  const swapChains = () => {
    setSourceId(destId);
    setAmount("");
  };

  const setMax = () => {
    const cap = Math.min(balanceN, maxN || balanceN, remainingN || balanceN);
    setAmount(cap > 0 ? String(cap) : "");
  };

  const bridge = async () => {
    if (!isConnected || !address) {
      open();
      return;
    }
    if (!token || !tokenAddr || !srcTok) return toast.error("Select a token");
    const to = (recipient.trim() || address) as `0x${string}`;
    if (!isAddress(to)) return toast.error("Invalid recipient address");
    if (amountNum <= 0) return toast.error("Enter an amount");
    if (error) return toast.error(error);

    try {
      setBusy(true);
      if (chainId !== sourceId) {
        toast.info(`Switch your wallet to ${src.label}`);
        await switchChainAsync({ chainId: sourceId });
      }
      const amtWei = parseUnits(amount, decimals);

      if (allowanceRaw < amtWei) {
        toast.info(`Approving ${srcTok.symbol}… confirm in your wallet`);
        const ah = await writeContractAsync({
          address: tokenAddr,
          abi: erc20Abi,
          functionName: "approve",
          args: [bridgeAddr, amtWei],
          chainId: sourceId,
        });
        await publicClient?.waitForTransactionReceipt({ hash: ah });
      }

      toast.info("Sending bridge transaction… confirm in your wallet");
      const hash = await writeContractAsync({
        address: bridgeAddr,
        abi: BRIDGE_ABI,
        functionName: "initiateBridge",
        args: [tokenAddr, amtWei, BigInt(destId), to],
        chainId: sourceId,
      });
      const receipt = await publicClient?.waitForTransactionReceipt({ hash });
      if (receipt && receipt.status !== "success")
        return toast.error("Bridge transaction failed");

      toast.success(
        `Bridge request submitted — you will receive ${dstTok?.symbol} on ${dst.short} shortly`,
      );
      setAmount("");
    } catch {
      toast.error("Bridge failed — check for wallet rejection / insufficient balance / limit exceeded");
    } finally {
      setBusy(false);
    }
  };

  const needsApprove =
    amountNum > 0 && !error && tokenAddr
      ? allowanceRaw < (() => {
          try {
            return parseUnits(amount, decimals);
          } catch {
            return 0n;
          }
        })()
      : false;

  const cta = !isConnected
    ? "Connect Wallet"
    : busy
      ? "Processing…"
      : needsApprove
        ? `Approve ${srcTok?.symbol} & Bridge`
        : "Bridge";

  return (
    <div className="mx-auto w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h2 className="text-sm font-semibold">Bridge</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">Move assets between chains</p>

      {/* Chains */}
      <div className="mt-4 flex items-center gap-2">
        <ChainBox title="Source chain" label={src.label} />
        <button
          type="button"
          onClick={swapChains}
          aria-label="Swap direction"
          className="mt-5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--surface)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          <ArrowDownUp className="h-4 w-4 rotate-90" />
        </button>
        <ChainBox title="Destination chain" label={dst.label} />
      </div>

      {/* Amount + token */}
      <div className="mt-4 rounded-2xl border border-[var(--border)] px-4 py-3">
        <div className="flex items-center justify-between text-xs text-[var(--muted)]">
          <span>Amount</span>
          <button onClick={setMax} className="transition-colors hover:text-[var(--foreground)]">
            Balance: {formatNumber(balanceN, 4)}{" "}
            <span className="font-medium text-[var(--accent)]">MAX</span>
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <input
            type="text"
            inputMode="decimal"
            value={formatAmountInput(amount)}
            onChange={(e) => setAmount(parseAmountInput(e.target.value))}
            placeholder="0"
            className="w-full bg-transparent text-2xl font-semibold outline-none placeholder:text-[var(--muted-2)]"
          />
          <div className="flex shrink-0 gap-1.5">
            {tokens.map((t) => {
              const sym = t.chains[sourceId]?.symbol ?? t.key;
              const active = t.key === token?.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTokenKey(t.key)}
                  className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "border-[var(--border)] text-[var(--muted)]"
                  }`}
                >
                  <TokenLogo symbol={sym} size={18} />
                  {sym}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Recipient */}
      <div className="mt-3 rounded-2xl border border-[var(--border)] px-4 py-3">
        <div className="flex items-center justify-between text-xs text-[var(--muted)]">
          <span>Recipient ({dst.short})</span>
          {address && (
            <button
              onClick={() => setRecipient(address)}
              className="font-medium text-[var(--accent)] transition-colors hover:opacity-80"
            >
              Use my address
            </button>
          )}
        </div>
        <input
          type="text"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder={address ?? "0x…"}
          spellCheck={false}
          className="mt-1.5 w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted-2)]"
        />
      </div>

      {/* Summary */}
      <div className="mt-3 space-y-1.5 rounded-2xl bg-[var(--surface)] px-4 py-3 text-xs">
        <Row label="Bridge Amount" value={`${formatNumber(amountNum, 6)} ${srcTok?.symbol ?? ""}`} />
        <Row label="Bridge Fee" value={`${feePercent}% · ${formatNumber(feeAmount, 6)}`} />
        <Row
          label="You Will Receive"
          value={`${formatNumber(receiveAmount, 6)} ${dstTok?.symbol ?? ""}`}
          strong
        />
        <div className="my-1 border-t border-[var(--border)]" />
        <Row label="Min Amount" value={`${formatNumber(minN, 6)} ${srcTok?.symbol ?? ""}`} muted />
        <Row label="Max Amount" value={`${formatNumber(maxN, 6)} ${srcTok?.symbol ?? ""}`} muted />
        <Row label="Daily Limit" value={`${formatNumber(dailyLimitN)} ${srcTok?.symbol ?? ""}`} muted />
        <Row label="Daily Used" value={`${formatNumber(dailyUsedN)} ${srcTok?.symbol ?? ""}`} muted />
        <Row label="Remaining" value={`${formatNumber(remainingN)} ${srcTok?.symbol ?? ""}`} muted />
      </div>

      {error && amountNum > 0 && (
        <p className="mt-2 text-center text-xs font-medium text-[var(--down)]">{error}</p>
      )}

      <button
        onClick={bridge}
        disabled={busy || !BRIDGE_ENABLED || (isConnected && (amountNum <= 0 || !!error))}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {cta}
      </button>

      <a
        href={`${src.explorer}/address/${bridgeAddr}`}
        target="_blank"
        rel="noreferrer"
        className="mt-3 flex items-center justify-center gap-1 text-[11px] text-[var(--muted-2)] transition-colors hover:text-[var(--muted)]"
      >
        Bridge contract <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

function ChainBox({ title, label }: { title: string; label: string }) {
  return (
    <div className="flex-1">
      <div className="mb-1 text-xs text-[var(--muted)]">{title}</div>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm font-semibold">
        {label}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? "text-[var(--muted-2)]" : "text-[var(--muted)]"}>{label}</span>
      <span
        className={
          strong
            ? "font-semibold text-[var(--accent)]"
            : muted
              ? "text-[var(--muted)]"
              : "font-medium"
        }
      >
        {value}
      </span>
    </div>
  );
}
