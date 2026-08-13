"use client";

// Legacy name kept so existing call sites don't churn: `useMetaMask` is now
// the multi-wallet connect hook (MetaMask + Zigap + any EIP-6963 wallet).
// See lib/use-wallet.tsx for the actual implementation.
export { useWalletConnect as useMetaMask } from "./use-wallet";
