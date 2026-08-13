"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cookieToInitialState, useAccount, WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { WalletPickerHost } from "@/lib/use-wallet";
import { useDexStore } from "@/lib/store";

const queryClient = new QueryClient();

/**
 * Mirrors the real wagmi wallet session into the Zustand store so the rest
 * of the app (balances, positions, games…) keys off the real address.
 * Ignores transient "connecting"/"reconnecting" states.
 */
function WalletSync() {
  const { address, status } = useAccount();
  const setWalletSession = useDexStore((s) => s.setWalletSession);

  useEffect(() => {
    if (status === "connected" && address) setWalletSession(address);
    else if (status === "disconnected") setWalletSession(null);
  }, [address, status, setWalletSession]);

  return null;
}

/**
 * Fire-and-forget analytics: one page view per device every 6 hours, plus a
 * count for each wallet that connects (server dedupes per KST day). Failures
 * are ignored.
 */
function AnalyticsTracker() {
  const { address, status } = useAccount();
  const reported = useRef<Set<string>>(new Set());

  const post = (body: Record<string, unknown>) =>
    fetch("/api/analytics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Count one visit per device every 6 hours. localStorage persists across
    // tabs/sessions (unlike sessionStorage), so reopening or new tabs don't
    // re-count until the 6h window elapses.
    const WINDOW_MS = 6 * 60 * 60 * 1000;
    const last = Number(localStorage.getItem("ioi_visited_at") ?? 0);
    if (Date.now() - last < WINDOW_MS) return;
    localStorage.setItem("ioi_visited_at", String(Date.now()));
    post({ event: "visit" });
  }, []);

  useEffect(() => {
    if (status !== "connected" || !address) return;
    const a = address.toLowerCase();
    if (reported.current.has(a)) return;
    reported.current.add(a);
    post({ event: "connect", address: a });
  }, [address, status]);

  return null;
}

export function Providers({
  children,
  cookies,
}: {
  children: ReactNode;
  cookies: string | null;
}) {
  const initialState = cookieToInitialState(wagmiConfig, cookies);

  return (
    <WagmiProvider config={wagmiConfig} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <WalletSync />
        <AnalyticsTracker />
        <WalletPickerHost />
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
