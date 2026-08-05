import type { Metadata } from "next";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./providers";
import { Navbar } from "@/components/Navbar";
import { Toaster } from "@/components/toast";
import { GlyphX } from "@/components/IOILogo";

// Runs before hydration to apply the saved (or system) theme and avoid a flash.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('ioi-theme');if(t==='dark'||(!t&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`;

// DaffiOne type stack: Inter Tight (display), Inter (body), JetBrains Mono
// (data/chrome). Korean glyphs fall back to Pretendard Variable, loaded via
// CDN @import in globals.css (next/font has no Pretendard).
const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetBrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  weight: ["400", "500"],
  subsets: ["latin"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const TITLE = "Xpulse — Ignite the Xphere Mainnet";
const DESCRIPTION =
  "Xpulse is a mini dApp for Xphere mainnet activation: play onchain games and claim rewards with MetaMask, live on Xphere.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Xpulse",
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    images: [
      {
        url: "/og.png",
        width: 1610,
        height: 977,
        alt: "Xpulse — Ignite the Xphere Mainnet",
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
    <html
      lang="en"
      suppressHydrationWarning
      className={`${interTight.variable} ${inter.variable} ${jetBrains.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[var(--background)]">
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT}
        </Script>
        <Providers cookies={cookies}>
        <Navbar />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-[var(--border)] py-7">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 sm:px-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <GlyphX size={20} />
              <span className="text-sm font-semibold tracking-[0.22em]">
                XPULSE
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-[var(--muted-2)]">
                Xphere Mainnet Activation
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-[0.06em] text-[var(--muted)]">
              <span className="inline-flex items-center gap-2">
                <span className="h-1.5 w-1.5 bg-[var(--dot-yellow)]" />
                Beta · live games
              </span>
              <span>Xphere Mainnet</span>
            </div>
          </div>
        </footer>
        <Toaster />
        </Providers>
      </body>
    </html>
  );
}
