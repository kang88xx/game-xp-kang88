"use client";

// Multi-wallet connect (MetaMask + Zigap + any EIP-6963 wallet).
//
// `useWalletConnect().open()` decides:
//   · several announced wallets → picker modal (names/icons from EIP-6963)
//   · exactly one wallet        → connect it directly
//   · nothing injected          → install modal (MetaMask / Zigap links)
//
// <WalletPickerHost /> renders the modal once, mounted in app/providers.tsx.
// The old `useMetaMask` name is re-exported from lib/use-metamask.ts so
// existing call sites keep working unchanged.

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useConnect, type Connector } from "wagmi";
import { CHAIN_ID } from "./chain";
import { toast } from "@/components/toast";

const METAMASK_INSTALL_URL = "https://metamask.io/download";
const ZIGAP_INSTALL_URL = "https://zigap.io/welcome";

// ─── Tiny external store for the modal (no context plumbing needed) ─────────

type PickerState =
  | { kind: "closed" }
  | { kind: "pick"; connectors: Connector[] }
  | { kind: "install" };

let pickerState: PickerState = { kind: "closed" };
const listeners = new Set<() => void>();

function setPicker(next: PickerState): void {
  pickerState = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const CLOSED: PickerState = { kind: "closed" };
function usePickerState(): PickerState {
  return useSyncExternalStore(
    subscribe,
    () => pickerState,
    () => CLOSED,
  );
}

// ─── Connect logic ──────────────────────────────────────────────────────────

// Only these two wallets are offered — every other announced extension
// (Rabby, Phantom, Coinbase, …) is deliberately hidden from the picker.
const ALLOWED_WALLETS = /metamask|zigap/i;

/**
 * Wallet candidates for the picker: EIP-6963-announced MetaMask/Zigap only
 * (announced connectors carry the wallet name + icon). The generic
 * `injected` fallback still applies when nothing allowed announced itself
 * but window.ethereum exists — that's the wallet in-app browser case
 * (Zigap mobile), where the provider never announces.
 */
function candidatesOf(connectors: readonly Connector[]): Connector[] {
  const announced = connectors.filter(
    (c) => c.id !== "injected" && ALLOWED_WALLETS.test(`${c.id} ${c.name}`),
  );
  if (announced.length > 0) return announced;
  return connectors.filter(
    (c) =>
      c.id === "injected" &&
      typeof window !== "undefined" &&
      typeof (window as { ethereum?: unknown }).ethereum !== "undefined",
  );
}

function friendlyError(err: unknown): void {
  const e = err as Error;
  if (e?.name === "ProviderNotFoundError") {
    setPicker({ kind: "install" });
  } else if (!/reject|denied|cancel/i.test(e?.message ?? "")) {
    toast.error("Failed to connect wallet");
  }
}

export function useWalletConnect() {
  const { connectAsync, connectors, isPending } = useConnect();

  const connectWith = useCallback(
    async (connector: Connector) => {
      setPicker(CLOSED);
      try {
        // chainId here also switches/adds Xphere in the same approval flow.
        await connectAsync({ connector, chainId: CHAIN_ID });
      } catch (err) {
        friendlyError(err);
      }
    },
    [connectAsync],
  );

  const open = useCallback(async () => {
    const candidates = candidatesOf(connectors);
    if (candidates.length === 0) {
      setPicker({ kind: "install" });
      return;
    }
    if (candidates.length === 1) {
      await connectWith(candidates[0]);
      return;
    }
    setPicker({ kind: "pick", connectors: candidates });
  }, [connectors, connectWith]);

  return { open, isPending, connectWith };
}

// ─── Modal host (rendered once, in providers) ───────────────────────────────

export function WalletPickerHost() {
  const state = usePickerState();
  const { connectWith } = useWalletConnect();
  const dialogRef = useRef<HTMLDivElement>(null);
  const open = state.kind !== "closed";

  // Dialog behavior: Escape closes, body scroll locks, first action focused.
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (
      dialogRef.current?.querySelector("button, a") as HTMLElement | null
    )?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPicker(CLOSED);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [open]);

  if (state.kind === "closed") return null;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={() => setPicker(CLOSED)}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Connect wallet"
        onClick={(e) => e.stopPropagation()}
        className="animate-fade-in max-h-[calc(100dvh-4rem)] w-full max-w-sm overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl"
      >
        <h2 className="text-base font-semibold">
          {state.kind === "pick" ? "Connect a wallet" : "No wallet found"}
        </h2>

        {state.kind === "pick" ? (
          <div className="mt-4 space-y-2">
            {state.connectors.map((c) => (
              <button
                key={c.uid}
                onClick={() => void connectWith(c)}
                className="flex w-full items-center gap-3 rounded-2xl border border-[var(--border-strong)] px-4 py-3 text-sm font-semibold transition-colors hover:bg-[var(--surface)]"
              >
                {c.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.icon} alt="" className="h-7 w-7 rounded-lg" />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--surface-2)] text-xs">
                    ◆
                  </span>
                )}
                {c.name === "Injected" ? "Browser wallet" : c.name}
              </button>
            ))}
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Install a wallet, or open this site inside your wallet&apos;s
              in-app browser, then try again.
            </p>
            <div className="mt-4 space-y-2">
              <a
                href={METAMASK_INSTALL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-between rounded-2xl border border-[var(--border-strong)] px-4 py-3 text-sm font-semibold transition-colors hover:bg-[var(--surface)]"
              >
                MetaMask
                <span className="text-xs text-[var(--muted)]">Install →</span>
              </a>
              <a
                href={ZIGAP_INSTALL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-between rounded-2xl border border-[var(--border-strong)] px-4 py-3 text-sm font-semibold transition-colors hover:bg-[var(--surface)]"
              >
                Zigap
                <span className="text-xs text-[var(--muted)]">Install →</span>
              </a>
            </div>
          </>
        )}

        <button
          onClick={() => setPicker(CLOSED)}
          className="mt-4 w-full rounded-2xl py-2.5 text-sm font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
