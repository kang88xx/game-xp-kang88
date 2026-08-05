"use client";

import { useCallback } from "react";
import { useConnect } from "wagmi";
import { CHAIN_ID } from "./chain";
import { toast } from "@/components/toast";

const METAMASK_INSTALL_URL = "https://metamask.io/download";

/**
 * MetaMask-only connect — drop-in for AppKit's `open()`. Connects the
 * injected MetaMask provider and switches/adds Xphere in the same step
 * (wagmi falls back to wallet_addEthereumChain for unknown chains).
 */
export function useMetaMask() {
  const { connectAsync, connectors, isPending } = useConnect();

  const open = useCallback(async () => {
    const metaMask =
      connectors.find((c) => c.id === "metaMask") ?? connectors[0];
    if (!metaMask) return;
    try {
      await connectAsync({ connector: metaMask, chainId: CHAIN_ID });
    } catch (err) {
      const e = err as Error;
      if (e.name === "ProviderNotFoundError") {
        toast.error("MetaMask is not installed");
        window.open(METAMASK_INSTALL_URL, "_blank", "noopener");
      } else if (!/reject|denied|cancel/i.test(e.message ?? "")) {
        toast.error("Failed to connect MetaMask");
      }
    }
  }, [connectAsync, connectors]);

  return { open, isPending };
}
