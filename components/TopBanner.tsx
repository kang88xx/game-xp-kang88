"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";

/**
 * Slim announcement strip below the navbar: live-on-mainnet badge and a
 * shortcut straight to the airdrop claim page. On the game page it sticks
 * under the sticky navbar (h-16 → top-16); on /claim the shortcut is hidden
 * since it would link to the page you're already on.
 */
export function TopBanner() {
  const pathname = usePathname();
  const onClaim = pathname.startsWith("/claim");
  const onGames = pathname === "/" || pathname.startsWith("/games");

  return (
    <div
      className={`border-b border-[var(--border)] bg-[var(--background)] ${
        onGames ? "sticky top-16 z-20" : ""
      }`}
    >
      <div className="mx-auto flex h-12 max-w-6xl items-center justify-between gap-3 px-4 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted)] sm:px-6">
        {/* Left: live badge */}
        <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[var(--border-strong)] px-3 py-1.5">
          <span className="dot-alive h-1.5 w-1.5 bg-[var(--dot-red)]" />
          <span className="whitespace-nowrap">
            Live on{" "}
            <span className="text-[var(--foreground)]">Xphere Mainnet</span>
          </span>
        </span>

        {/* Right: claim shortcut (hidden on the claim page itself) */}
        {!onClaim && (
          <Link
            href="/claim"
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[var(--accent)] px-3.5 py-1.5 font-sans text-xs font-semibold normal-case tracking-normal text-white transition-all hover:bg-[var(--accent-hover)] active:scale-[0.985]"
          >
            Claim airdrop
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}
