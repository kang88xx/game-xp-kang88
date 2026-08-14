import type { Token } from "./types";

// ------------------------------------------------------------------
//  Xphere Mainnet token registry (chainId 20250217)
//
//  `priceUsd`/`change24h`/`volume24h`/`marketCap` are SEED values only.
//  `address: null` = native XP. Pricing sources:
//   • XP — live from CoinGecko (id "xphere"; it's a native L1 coin, no
//     contract there either)
//   • USDX — the $1 anchor (the ecosystem's bridged-USDT stable)
//   • everything else — priced server-side from its USDX pool on OUR
//     factory (see /api/prices); $0 until a USDX pool is seeded on /pools
//
//  Add new tokens here (or via the admin panel) as they are deployed.
// ------------------------------------------------------------------

export const TOKENS: Token[] = [
  {
    symbol: "XP",
    name: "Xphere",
    address: null, // native coin — CoinGecko lists no contract either
    decimals: 18,
    coingeckoId: "xphere", // live USD price/24h/mcap/volume from CoinGecko
    priceUsd: 0.0277, // seed until the first fetch resolves
    change24h: 0,
    volume24h: 1_000_000,
    marketCap: 77_000_000,
    color: "#000000", // black circle behind the mark
    logoUrl: "/tokens/XP.svg",
    logoScale: 0.8, // icon runs large — shrink 20% so corners aren't clipped
  },
  {
    // Ecosystem stable (XPBridge-bridged USDT). The app's USD anchor:
    // assumed ≈$1; every pool-priced token is quoted against it.
    symbol: "USDX",
    name: "USDX",
    address: "0xb48e189b1059e4D5C8fd154021a0516ff71a8514",
    decimals: 6, // USDX is 6 decimals (NOT 18) — per-token decimals handle this
    coingeckoId: null,
    priceUsd: 1.0,
    change24h: 0,
    volume24h: 0,
    marketCap: 0,
    color: "#000000",
    // Official USDX badge from the Xphere explorer (api.tamsa.io) — the SVG
    // carries its own dark circle, so render it transparent at full size.
    logoUrl: "/tokens/USDX.svg",
    logoTransparent: true,
  },
  {
    // KANGTEST1 — LMS mini-game bet token. Minted from our TokenFactory
    // (basic template), so it's a guaranteed standard ERC-20
    // (no fee-on-transfer / rebase).
    symbol: "KANGTEST1",
    name: "kangtest1",
    address: "0x221b309862ba2d7d01906A743BE1685253698aA8",
    decimals: 18,
    coingeckoId: null,
    priceUsd: 0,
    change24h: 0,
    volume24h: 0,
    marketCap: 0,
    color: "#000000", // black circle behind the red Kang mark
    logoUrl: "/tokens/KANGTEST1.svg",
    logoScale: 0.8, // keep the mark clear of the circle's edge
  },
];

export const TOKEN_MAP: Record<string, Token> = Object.fromEntries(
  TOKENS.map((t) => [t.symbol, t]),
);

export function getToken(symbol: string): Token | undefined {
  return TOKEN_MAP[symbol];
}

/** ERC-20 tokens with a real contract (for on-chain balance reads) */
export const ERC20_TOKENS = TOKENS.filter(
  (t): t is Token & { address: string } => t.address !== null,
);
