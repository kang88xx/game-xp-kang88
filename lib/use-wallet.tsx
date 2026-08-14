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
import { X } from "lucide-react";
import { useConnect, type Connector } from "wagmi";
import { CHAIN_ID } from "./chain";
import { openZigapLogin } from "./zigap";
import { toast } from "@/components/toast";

const METAMASK_INSTALL_URL = "https://metamask.io/download";
const ZIGAP_INSTALL_URL = "https://zigap.io/welcome";

/**
 * Mobile browsers can't run wallet extensions, so "installed" is
 * undetectable there — the apps may well be on the phone. Instead of the
 * install links we deep-link into the wallet's own in-app browser.
 */
function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod|android/i.test(navigator.userAgent);
}

/** Universal link that reopens the current page inside MetaMask mobile's
    in-app browser (falls through to the app store when not installed). */
function metamaskDeepLink(): string {
  const { host, pathname, search } = window.location;
  return `https://metamask.app.link/dapp/${host}${pathname}${search}`;
}

// ─── Tiny external store for the modal (no context plumbing needed) ─────────

/** One fixed row in the picker: the brand, and its connector when installed. */
interface BrandEntry {
  brand: "MetaMask" | "ZIGAP";
  logo: string; // bundled brand asset — same size for both rows
  connector: Connector | null;
  installUrl: string;
}

type PickerState = { kind: "closed" } | { kind: "pick"; entries: BrandEntry[] };

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
/**
 * The picker always offers exactly these two brands. An EIP-6963-announced
 * connector fills a brand's slot when that wallet is installed; otherwise
 * the row links to the install page. Every other announced extension
 * (Rabby, Phantom, Coinbase, …) is deliberately hidden.
 */
function brandEntries(connectors: readonly Connector[]): BrandEntry[] {
  const find = (re: RegExp) =>
    connectors.find(
      (c) => c.id !== "injected" && re.test(`${c.id} ${c.name}`),
    ) ?? null;
  return [
    {
      brand: "MetaMask",
      logo: "/wallets/metamask.svg",
      connector: find(/metamask/i),
      installUrl: METAMASK_INSTALL_URL,
    },
    {
      brand: "ZIGAP",
      logo: "/wallets/zigap.png",
      connector: find(/zigap/i),
      installUrl: ZIGAP_INSTALL_URL,
    },
  ];
}

/**
 * Wallet in-app browsers (Zigap mobile, MetaMask mobile) expose
 * window.ethereum without announcing via EIP-6963 — there the generic
 * injected connector connects directly, no picker needed.
 */
function inAppInjected(connectors: readonly Connector[]): Connector | null {
  const anyAnnounced = connectors.some((c) => c.id !== "injected");
  if (anyAnnounced || typeof window === "undefined") return null;
  if (typeof (window as { ethereum?: unknown }).ethereum === "undefined") {
    return null;
  }
  return connectors.find((c) => c.id === "injected") ?? null;
}

function friendlyError(err: unknown): void {
  const e = err as Error;
  if (e?.name === "ProviderNotFoundError") {
    toast.error("Wallet not found — install MetaMask or Zigap");
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
    // Inside a wallet's in-app browser there is exactly one wallet — connect
    // straight to it. Everywhere else, always show the MetaMask/Zigap choice.
    const inApp = inAppInjected(connectors);
    if (inApp) {
      await connectWith(inApp);
      return;
    }
    setPicker({ kind: "pick", entries: brandEntries(connectors) });
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
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Connect a wallet</h2>
          <button
            onClick={() => setPicker(CLOSED)}
            aria-label="Close"
            className="-mr-1.5 -mt-1.5 flex h-9 w-9 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {state.entries.map((entry) =>
            entry.connector ? (
              <button
                key={entry.brand}
                onClick={() => void connectWith(entry.connector!)}
                className="flex w-full items-center gap-3 rounded-2xl border border-[var(--border-strong)] px-4 py-3 text-sm font-semibold transition-colors hover:bg-[var(--surface)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={entry.logo}
                  alt=""
                  className="h-7 w-7 rounded-lg object-contain"
                />
                {entry.brand}
              </button>
            ) : isMobileBrowser() && entry.brand === "MetaMask" ? (
              // Same-tab universal link — reopens this page inside the
              // MetaMask app's browser where window.ethereum exists.
              <a
                key={entry.brand}
                href={metamaskDeepLink()}
                className="flex w-full items-center gap-3 rounded-2xl border border-[var(--border-strong)] px-4 py-3 text-sm font-semibold transition-colors hover:bg-[var(--surface)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={entry.logo}
                  alt=""
                  className="h-7 w-7 rounded-lg object-contain"
                />
                <span className="flex-1 text-left">{entry.brand}</span>
                <span className="text-xs">Open in app →</span>
              </a>
            ) : entry.brand === "ZIGAP" ? (
              // ZIGAP 정식 연동(zigap-utils) — 데스크톱은 QR, 모바일은 원탭
              // 딥링크로 ZIGAP 앱이 열려 로그인된다.
              <button
                key={entry.brand}
                onClick={() => {
                  setPicker(CLOSED);
                  openZigapLogin();
                }}
                className="flex w-full items-center gap-3 rounded-2xl border border-[var(--border-strong)] px-4 py-3 text-sm font-semibold transition-colors hover:bg-[var(--surface)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={entry.logo}
                  alt=""
                  className="h-7 w-7 rounded-lg object-contain"
                />
                <span className="flex-1 text-left">{entry.brand}</span>
                <span className="text-xs">
                  {isMobileBrowser() ? "One-tap connect →" : "QR connect →"}
                </span>
              </button>
            ) : (
              <a
                key={entry.brand}
                href={entry.installUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center gap-3 rounded-2xl border border-[var(--border-strong)] px-4 py-3 text-sm font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--surface)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={entry.logo}
                  alt=""
                  className="h-7 w-7 rounded-lg object-contain opacity-80"
                />
                <span className="flex-1 text-left">{entry.brand}</span>
                <span className="text-xs">Not installed · Install →</span>
              </a>
            ),
          )}
        </div>

        {isMobileBrowser() && (
          <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
            On mobile, connect from inside your wallet app&apos;s built-in
            browser — extensions can&apos;t attach to this browser.
          </p>
        )}

      </div>
    </div>
  );
}
