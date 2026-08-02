// Server-only viem public client for Xphere Mainnet — used by API routes
// that must verify on-chain facts themselves (never trust the client).
import "server-only";
import { createPublicClient, http, type PublicClient } from "viem";
import { RPC_URL, XPHERE_VIEM } from "./chain";

let client: PublicClient | null = null;

export function serverRpc(): PublicClient {
  if (!client) {
    client = createPublicClient({
      chain: XPHERE_VIEM,
      transport: http(process.env.XPHERE_RPC ?? RPC_URL),
    });
  }
  return client;
}
