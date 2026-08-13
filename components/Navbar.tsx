"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X, ShieldCheck } from "lucide-react";
import { WalletButton } from "./WalletButton";
import { ThemeToggle } from "./ThemeToggle";
import { XphereMark } from "./XphereLogo";

const LINKS = [
  { href: "/", label: "Games" },
  { href: "/claim", label: "Claim" },
] as { href: string; label: string }[];

export function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-8">
          {/* stake.x-phere.com lockup form: glyph + `XP UNION / VAULT` → ours */}
          <Link href="/" className="flex items-center gap-2.5">
            <XphereMark size={22} />
            <span className="font-mono text-[15px] font-bold uppercase tracking-[0.18em] text-[var(--foreground)]">
              XP
            </span>
            <span className="-mx-0.5 font-mono text-[15px] font-bold text-[var(--muted-2)]">
              /
            </span>
            <span className="font-mono text-[15px] font-bold uppercase tracking-[0.18em] text-[var(--muted-2)]">
              GAME
            </span>
          </Link>

          {/* stake tabs — active reads ember, no underline */}
          <nav className="hidden items-center gap-1 md:flex">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  isActive(l.href)
                    ? "text-[var(--accent-bright)]"
                    : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/admin"
            title="Admin panel"
            className={`hidden h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] transition-colors hover:bg-[var(--surface)] sm:flex ${
              pathname.startsWith("/admin")
                ? "text-[var(--accent)]"
                : "text-[var(--muted)]"
            }`}
          >
            <ShieldCheck className="h-4 w-4" />
          </Link>
          <WalletButton />
          <button
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] md:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Menu"
          >
            {mobileOpen ? (
              <X className="h-4 w-4" />
            ) : (
              <Menu className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav className="border-t border-[var(--border)] px-4 py-2 md:hidden">
          {[...LINKS, { href: "/admin", label: "Admin" }].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setMobileOpen(false)}
              className={`block rounded-xl px-3 py-2.5 text-sm font-medium ${
                isActive(l.href)
                  ? "bg-[var(--surface-2)] text-[var(--accent-bright)]"
                  : "text-[var(--muted)]"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
