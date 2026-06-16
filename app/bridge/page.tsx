import { ArrowLeftRight } from "lucide-react";
import { BridgePanel } from "@/components/BridgePanel";
import { Eyebrow } from "@/components/ui";
import { BRIDGE_CHAINS, XPHERE_CHAIN_ID, BSC_CHAIN_ID } from "@/lib/bridge";

export const metadata = {
  title: "Bridge — IOI",
};

export default function BridgePage() {
  const a = BRIDGE_CHAINS[XPHERE_CHAIN_ID].short;
  const b = BRIDGE_CHAINS[BSC_CHAIN_ID].short;
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Eyebrow dot="blue" className="mb-5">
        Transfer · Bridge
      </Eyebrow>
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent-soft)]">
          <ArrowLeftRight className="h-6 w-6 text-[var(--accent)]" />
        </span>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Bridge</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--up-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--up)]">
              Live
            </span>
          </div>
          <p className="text-sm text-[var(--muted)]">
            Move assets between {a} and {b}.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <BridgePanel />
      </div>
    </div>
  );
}
