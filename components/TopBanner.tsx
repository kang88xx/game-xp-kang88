"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
      className={`border-b border-black/20 ${onGames ? "sticky top-16 z-20" : ""}`}
      style={{ backgroundImage: "var(--grad-brand)" }}
    >
      <div className="mx-auto flex h-12 max-w-6xl items-center justify-between gap-3 px-4 font-mono text-[11px] uppercase tracking-[0.18em] text-[#190501] sm:px-6">
        {/* Left: live badge */}
        <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-black/25 px-3 py-1.5">
          <span className="dot-live h-1.5 w-1.5 rounded-full bg-[#cf1512]" />
          <span className="whitespace-nowrap">
            Live on <span className="font-bold">Xphere Mainnet</span>
          </span>
        </span>

        {/* Right: claim shortcut (hidden on the claim page itself) */}
        {!onClaim && (
          <Link
            href="/claim"
            className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-black px-3.5 py-1.5 font-sans text-xs font-semibold normal-case tracking-normal text-white transition-all hover:-translate-y-px hover:bg-[#ffeed4] hover:text-[#190501] hover:shadow-[0_6px_20px_rgba(25,5,1,0.28)] active:translate-y-0 active:scale-[0.985]"
          >
            Claim airdrop
          </Link>
        )}
      </div>
    </div>
  );
}
