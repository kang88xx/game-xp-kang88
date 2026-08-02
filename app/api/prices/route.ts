import { NextResponse } from "next/server";
import { formatUnits } from "viem";
import { TOKENS } from "@/lib/tokens";
import { NATIVE_SYMBOL, PANCAKE_FACTORY, WNATIVE } from "@/lib/chain";
import { serverRpc } from "@/lib/server-rpc";
import { volume24hByPair } from "@/lib/analytics-store";
import { recordPriceSnapshot, change24h } from "@/lib/price-history";
import type { MarketData } from "@/lib/types";

// Live prices change constantly — never prerender this route.
// Upstream CoinGecko responses are cached for 60s via fetch revalidate.
export const dynamic = "force-dynamic";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

const FACTORY_ABI = [
  {
    type: "function",
    name: "getPair",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "address" }],
  },
] as const;
const PAIR_ABI = [
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint112" }, { type: "uint112" }, { type: "uint32" }],
  },
  {
    type: "function",
    name: "token0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;
const ERC20_ABI = [
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

/**
 * Price listed tokens that have a contract but no CoinGecko feed (e.g. KANG)
 * from their on-chain USDT pool: price = USDT-per-token from the pair reserves
 * × USDT's USD price. Market cap = price × totalSupply; 24h volume = this
 * site's rolling swap volume for the pair (same source as the pools' Fee APR).
 */
async function applyPoolPrices(out: Record<string, MarketData>): Promise<void> {
  const usdx = TOKENS.find((t) => t.symbol === "USDX");
  if (!usdx?.address) return;
  const pUsdx = out.USDX?.priceUsd || 1; // USDX is the $1 anchor
  const vol = await volume24hByPair();
  const rpc = serverRpc();
  const usdtAddr = usdx.address as `0x${string}`;

  // Every non-anchor token, including native XP — XP trades as WXP in pairs.
  const targets = TOKENS.filter(
    (t) =>
      !t.coingeckoId &&
      t.symbol !== "USDX" &&
      (t.address ||
        (t.symbol === NATIVE_SYMBOL && WNATIVE !== ZERO_ADDR)),
  );
  await Promise.all(
    targets.map(async (t) => {
      try {
        const tokenAddr = (t.address ?? WNATIVE) as `0x${string}`;
        const pair = (await rpc.readContract({
          address: PANCAKE_FACTORY,
          abi: FACTORY_ABI,
          functionName: "getPair",
          args: [tokenAddr, usdtAddr],
        })) as `0x${string}`;
        if (!pair || pair.toLowerCase() === ZERO_ADDR) return;

        const [reserves, token0] = await Promise.all([
          rpc.readContract({ address: pair, abi: PAIR_ABI, functionName: "getReserves" }),
          rpc.readContract({ address: pair, abi: PAIR_ABI, functionName: "token0" }),
        ]);
        const [r0, r1] = reserves as readonly [bigint, bigint, number];
        const tokenIs0 = (token0 as string).toLowerCase() === tokenAddr.toLowerCase();
        const reserveToken = tokenIs0 ? r0 : r1;
        const reserveUsdt = tokenIs0 ? r1 : r0;
        if (reserveToken === 0n || reserveUsdt === 0n) return;

        const rTok = Number(formatUnits(reserveToken, t.decimals));
        const rUsd = Number(formatUnits(reserveUsdt, usdx.decimals));
        const price = (rUsd / rTok) * pUsdx;

        let marketCap = 0;
        if (t.address) {
          // ERC-20 only — WXP's totalSupply is just the wrapped amount, not
          // native XP's supply, so native XP keeps mcap 0.
          try {
            const supply = (await rpc.readContract({
              address: tokenAddr,
              abi: ERC20_ABI,
              functionName: "totalSupply",
            })) as bigint;
            marketCap = Number(formatUnits(supply, t.decimals)) * price;
          } catch {
            // no totalSupply → leave market cap at 0
          }
        }

        // Hourly snapshot + real 24h change (vs the listing price until a
        // full day of history exists — standard new-listing behavior).
        await recordPriceSnapshot(t.symbol, price);
        const change = await change24h(t.symbol, price);

        const pairKey = [t.symbol, "USDX"].sort().join("-");
        out[t.symbol] = {
          priceUsd: price,
          change24h: change,
          volume24h: vol[pairKey] ?? 0,
          marketCap,
          spark7d: [],
        };
      } catch {
        // RPC failure for this token → keep its seed/zero values
      }
    }),
  );
}

const COINGECKO_IDS = TOKENS.filter((t) => t.coingeckoId)
  .map((t) => t.coingeckoId)
  .join(",");

interface CoinGeckoMarketRow {
  id: string;
  current_price: number | null;
  price_change_percentage_24h: number | null;
  total_volume: number | null;
  market_cap: number | null;
  sparkline_in_7d?: { price: number[] };
}

function seedData(): Record<string, MarketData> {
  return Object.fromEntries(
    TOKENS.map((t) => [
      t.symbol,
      {
        priceUsd: t.priceUsd,
        change24h: t.change24h,
        volume24h: t.volume24h,
        marketCap: t.marketCap,
        spark7d: [],
      },
    ]),
  );
}

export async function GET() {
  const out = seedData();

  // Xphere tokens have no CoinGecko listings today — this block only runs
  // if a future token sets a coingeckoId.
  try {
    if (!COINGECKO_IDS) throw new Error("no coingecko-listed tokens");
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${COINGECKO_IDS}&sparkline=true&price_change_percentage=24h`,
      { next: { revalidate: 60 } },
    );
    if (res.ok) {
      const rows: CoinGeckoMarketRow[] = await res.json();
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const t of TOKENS) {
        const r = t.coingeckoId ? byId.get(t.coingeckoId) : undefined;
        if (!r) continue;
        out[t.symbol] = {
          priceUsd: r.current_price ?? t.priceUsd,
          change24h: r.price_change_percentage_24h ?? 0,
          volume24h: r.total_volume ?? t.volume24h,
          marketCap: r.market_cap ?? t.marketCap,
          spark7d: r.sparkline_in_7d?.price ?? [],
        };
      }
    }
  } catch {
    // network/rate-limit failure → serve seed values, client retries in 60s
  }

  // Pool-derived prices (XP, KDG, …) quoted against the USDX anchor.
  // Never blocks the response.
  try {
    await applyPoolPrices(out);
  } catch {
    // on-chain read failure → seeds/coingecko values stand
  }

  return NextResponse.json(out);
}
