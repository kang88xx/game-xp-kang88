import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { decodeEventLog, formatUnits, parseAbiItem } from "viem";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/admin-auth";
import {
  recordVisit,
  recordConnection,
  recordVolume,
  todaySummary,
} from "@/lib/analytics-store";
import { NATIVE_SYMBOL, PANCAKE_FACTORY, PANCAKE_ROUTER, WNATIVE } from "@/lib/chain";
import { serverRpc } from "@/lib/server-rpc";
import { TOKENS } from "@/lib/tokens";

export const dynamic = "force-dynamic";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

// Single-swap sanity ceiling — anything above this is noise or abuse.
const MAX_SWAP_USD = 1_000_000;
// A swap must be reported promptly — blocks replaying historical router txs
// (anyone's, scraped from the explorer) as fresh volume.
const MAX_SWAP_AGE_S = 15 * 60;

// Uniswap-V2 pair Swap event — emitted by the canonical pair contract on every
// swap. We re-derive USD volume and the traded pair from these on-chain logs;
// the client's self-reported volumeUsd/pair are NEVER trusted.
const SWAP_EVENT = parseAbiItem(
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
);
const PAIR_TOKENS_ABI = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;
const FACTORY_GETPAIR_ABI = [
  {
    type: "function",
    name: "getPair",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "address" }],
  },
] as const;

/** Lowercased ERC-20 address → listed token symbol. WXP resolves to native XP. */
const ADDR_TO_SYMBOL = new Map<string, string>(
  TOKENS.flatMap((t) => (t.address ? [[t.address.toLowerCase(), t.symbol]] : [])),
);
if (WNATIVE && WNATIVE.toLowerCase() !== ZERO_ADDR) {
  ADDR_TO_SYMBOL.set(WNATIVE.toLowerCase(), NATIVE_SYMBOL);
}
const USDX = TOKENS.find((t) => t.symbol === "USDX");

interface DerivedSwap {
  volumeUsd: number;
  pair: string;
}

/**
 * Verifies the tx is a recent, successful router swap AND derives the trade's
 * USD volume + pair from the on-chain Swap logs — so a forged volumeUsd/pair in
 * the request body can't poison the public volume/APR figures. USD is measured
 * on the USDX leg (the $1 anchor): for each Swap whose pair contains USDX we
 * read the canonical pair's tokens, confirm it against the factory, and take the
 * USDX amount that moved. The largest such leg in the tx is the trade size, and
 * the other token of that pair names the pair key. Returns null when the tx
 * isn't a valid/recent router swap or has no priceable USDX leg (fail closed).
 */
async function deriveRouterSwap(
  txHash: `0x${string}`,
): Promise<DerivedSwap | null> {
  if (!USDX?.address) return null;
  const usdxAddr = USDX.address.toLowerCase();
  try {
    const rpc = serverRpc();
    const receipt = await rpc.getTransactionReceipt({ hash: txHash });
    if (
      receipt.status !== "success" ||
      (receipt.to ?? "").toLowerCase() !== PANCAKE_ROUTER.toLowerCase()
    )
      return null;

    const block = await rpc.getBlock({ blockNumber: receipt.blockNumber });
    if (Math.floor(Date.now() / 1000) - Number(block.timestamp) > MAX_SWAP_AGE_S)
      return null;

    // Decode the Swap logs (non-Swap logs throw and are skipped).
    const swaps: { pair: `0x${string}`; a0In: bigint; a1In: bigint; a0Out: bigint; a1Out: bigint }[] = [];
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: [SWAP_EVENT], data: log.data, topics: log.topics });
        if (ev.eventName !== "Swap") continue;
        const a = ev.args as unknown as {
          amount0In: bigint;
          amount1In: bigint;
          amount0Out: bigint;
          amount1Out: bigint;
        };
        swaps.push({
          pair: log.address as `0x${string}`,
          a0In: a.amount0In,
          a1In: a.amount1In,
          a0Out: a.amount0Out,
          a1Out: a.amount1Out,
        });
      } catch {
        // not a Swap event → ignore
      }
    }
    if (swaps.length === 0) return null;

    let best: DerivedSwap | null = null;
    for (const s of swaps) {
      // Read the pair's real tokens; skip pairs that don't involve USDX.
      let token0: string;
      let token1: string;
      try {
        [token0, token1] = (await Promise.all([
          rpc.readContract({ address: s.pair, abi: PAIR_TOKENS_ABI, functionName: "token0" }),
          rpc.readContract({ address: s.pair, abi: PAIR_TOKENS_ABI, functionName: "token1" }),
        ])) as [string, string];
      } catch {
        continue;
      }
      const t0 = token0.toLowerCase();
      const t1 = token1.toLowerCase();
      const usdxIs0 = t0 === usdxAddr;
      const usdxIs1 = t1 === usdxAddr;
      if (!usdxIs0 && !usdxIs1) continue;

      // Confirm this is the canonical factory pair — defeats spoofed Swap logs
      // emitted from a non-pair contract within the same router tx.
      try {
        const canonical = (await rpc.readContract({
          address: PANCAKE_FACTORY,
          abi: FACTORY_GETPAIR_ABI,
          functionName: "getPair",
          args: [token0 as `0x${string}`, token1 as `0x${string}`],
        })) as string;
        if (canonical.toLowerCase() !== s.pair.toLowerCase()) continue;
      } catch {
        continue;
      }

      // The USDX that moved on this hop (exactly one of in/out is non-zero).
      const usdxRaw = usdxIs0 ? s.a0In + s.a0Out : s.a1In + s.a1Out;
      if (usdxRaw === 0n) continue;
      const usd = Number(formatUnits(usdxRaw, USDX.decimals));
      if (!Number.isFinite(usd) || usd <= 0) continue;

      const otherAddr = usdxIs0 ? t1 : t0;
      const otherSym = ADDR_TO_SYMBOL.get(otherAddr);
      if (!otherSym) continue; // not a listed token → can't name the pair
      if (!best || usd > best.volumeUsd) {
        best = { volumeUsd: usd, pair: [otherSym, "USDX"].sort().join("-") };
      }
    }
    if (!best) return null;
    if (best.volumeUsd > MAX_SWAP_USD) best.volumeUsd = MAX_SWAP_USD;
    return best;
  } catch {
    return null; // not found / RPC failure → fail closed
  }
}

// Ingest a single event. Public — any visitor reports their own page view /
// wallet connect / completed swap. Counters are deduped server-side; swap
// volume + pair are derived ON-CHAIN from a verified, unseen router tx —
// client-supplied volumeUsd/pair are ignored.
export async function POST(req: Request) {
  let body: {
    event?: string;
    address?: string;
    txHash?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    // empty / malformed body → falls through to 400 below
  }

  switch (body.event) {
    case "visit":
      await recordVisit();
      break;
    case "connect":
      if (
        typeof body.address === "string" &&
        /^0x[a-fA-F0-9]{40}$/.test(body.address)
      ) {
        await recordConnection(body.address);
      }
      break;
    case "swap": {
      const { txHash } = body;
      if (typeof txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
        return NextResponse.json(
          { ok: false, error: "invalid swap report" },
          { status: 400 },
        );
      }
      const derived = await deriveRouterSwap(txHash as `0x${string}`);
      if (!derived) {
        return NextResponse.json(
          { ok: false, error: "unverified swap" },
          { status: 422 },
        );
      }
      await recordVolume(derived.volumeUsd, txHash, derived.pair);
      break;
    }
    default:
      return NextResponse.json(
        { ok: false, error: "unknown event" },
        { status: 400 },
      );
  }
  return NextResponse.json({ ok: true });
}

// Today's KST summary — admin only.
export async function GET() {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!verifySessionToken(token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await todaySummary());
}
