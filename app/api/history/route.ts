import { NextResponse } from "next/server";
import { TOKENS } from "@/lib/tokens";

export const dynamic = "force-dynamic";

// Only proxy ids we actually list (no open proxy) and known ranges.
const VALID_IDS = new Set(
  TOKENS.flatMap((t) => (t.coingeckoId ? [t.coingeckoId] : [])),
);
const VALID_DAYS = new Set(["1", "7", "30", "365"]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id") ?? "";
  const days = searchParams.get("days") ?? "30";

  if (!VALID_IDS.has(id) || !VALID_DAYS.has(days)) {
    return NextResponse.json({ error: "invalid params" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`,
      { next: { revalidate: 300 } },
    );
    if (!res.ok) {
      return NextResponse.json({ error: "upstream" }, { status: 502 });
    }
    const json: { prices: [number, number][] } = await res.json();
    return NextResponse.json({ prices: json.prices ?? [] });
  } catch {
    return NextResponse.json({ error: "upstream" }, { status: 502 });
  }
}
