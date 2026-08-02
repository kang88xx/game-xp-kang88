"use client";

import { useState } from "react";
import { SwapCard, type SwapPair } from "./SwapCard";
import { MarketSection } from "./MarketSection";

/**
 * Home trading board — the swap card and the market chart/table share one
 * token pair. The chart always shows the swap's RECEIVE (buy) side, and
 * clicking a token in the market table trades it against USDX (USDX itself
 * falls back to the USDX↔XP pair).
 */
export function TradeBoard() {
  const [pair, setPair] = useState<SwapPair>({ from: "USDX", to: "XP" });

  const pickFromTable = (symbol: string) =>
    setPair(
      symbol === "USDX"
        ? { from: "XP", to: "USDX" }
        : { from: "USDX", to: symbol },
    );

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-20 lg:self-start">
        <SwapCard pair={pair} onPairChange={setPair} />
      </div>
      <MarketSection chartSymbol={pair.to} onTokenSelect={pickFromTable} />
    </div>
  );
}
