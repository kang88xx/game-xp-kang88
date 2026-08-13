import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./providers";
import { Navbar } from "@/components/Navbar";
import { Toaster } from "@/components/toast";
import { XphereLockup } from "@/components/XphereLogo";
import { AddNetworkButton } from "@/components/AddNetworkButton";
import { TopBanner } from "@/components/TopBanner";

// Runs before hydration to apply the saved theme and avoid a flash.
// Dark is the default (the x-phere.com brand ground); light is opt-in.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('ioi-theme');if(t!=='light'){document.documentElement.classList.add('dark');}}catch(e){document.documentElement.classList.add('dark');}})();`;

// x-phere type stack: Pretendard Variable (display + body + KR), loaded
// via CDN @import in globals.css (next/font has no Pretendard); data and
// chrome use the system mono stack — no webfonts to load.

// Canonical production URL. Hardcoded on purpose: xp.game.kang88.io is the
// ONLY public domain, and a stale NEXT_PUBLIC_SITE_URL on the host (it once
// pointed at the retired ioidex.kang88.io) must not break OG/share links.
const SITE_URL = "https://xp.game.kang88.io";
const TITLE = "Xphere Mainnet Mini Game";
const DESCRIPTION =
  "Play onchain mini games on the Xphere mainnet and claim token rewards with MetaMask.";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Xphere Mainnet Mini Game",
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    images: [
      {
        url: "/og.png",
        width: 1610,
        height: 977,
        alt: "Xphere Mainnet Mini Game",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // wagmi SSR: rehydrate the wallet session from the request cookie
  const cookies = (await headers()).get("cookie");

  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[var(--background)]">
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT}
        </Script>
        <Providers cookies={cookies}>
        <Navbar />
        <TopBanner />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-[var(--border)] py-7">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 sm:px-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <XphereLockup size={16} />
              <span className="text-xs text-[var(--muted-2)]">
                Xphere Mainnet Activation
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--muted)]">
              <span className="inline-flex items-center gap-2 font-mono text-[#6fce9f]">
                <span className="dot-live h-1.5 w-1.5 rounded-full bg-[#6fce9f]" />
                Beta · live games
              </span>
              <AddNetworkButton />
            </div>
          </div>
        </footer>
        <Toaster />
        </Providers>
      </body>
    </html>
  );
}
