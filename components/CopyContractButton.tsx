"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { toast } from "./toast";

/**
 * Icon button that copies a token's contract address to the clipboard.
 * Renders nothing for native coins (address == null/undefined).
 */
export function CopyContractButton({
  address,
  symbol,
  className = "",
}: {
  address: string | null | undefined;
  symbol: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  if (!address) return null;

  const copy = () => {
    navigator.clipboard?.writeText(address);
    setCopied(true);
    toast.info(`${symbol} contract address copied`);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={`Copy ${symbol} contract address`}
      aria-label={`Copy ${symbol} contract address`}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] transition-colors hover:border-[var(--border-strong)] ${className}`}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-[var(--up)]" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-[var(--muted)]" />
      )}
    </button>
  );
}
