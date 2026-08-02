# IOI — DEX Frontend on Xphere

A clean, minimal **DEX frontend** built with Next.js, running on **Xphere
Mainnet** (chainId 20250217). Swaps execute against **PumpkinSwap**'s
Uniswap-V2-style contracts on Xphere — liquidity is provisioned on
[pumpkinswap.app](https://pumpkinswap.app), not here.

> Design system: **Pharos v2** — Inter Tight + IBM Plex Mono, Pharos blue (`#1A1AEE`), light/dark.

## Features

| Page | What it does |
| --- | --- |
| **Swap** (`/`) | Token-to-token swap with live quote, slippage, fee & min-received — routed to PumpkinSwap's router. |
| **Games** (`/games`) | Last Man Standing — on-chain KDG betting game (KangLMS contract). |
| **Portfolio** (`/portfolio`) | Total balance, token holdings, and activity history. |
| **Airdrop** (`/airdrop`) | Claim token rewards from active campaigns (public / whitelist / LP-gated). |
| **Admin** (`/admin`) | Create & manage tokens, pools registry, airdrop campaigns and whitelists. |

### Airdrop / Admin model

Admins create **campaigns** that specify a reward token, amount per wallet, total
allocation, and an **eligibility rule**:

- **Public** — any connected wallet can claim once.
- **Whitelist** — only wallet addresses the admin adds can claim.
- **LP** — the wallet must hold a liquidity position in a linked pool.

Users claim from `/airdrop`; the reward is credited to their (mock) balance and
the campaign progress updates.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Try the demo flow

1. Click **Connect Wallet** (generates a mock address + demo balances).
2. **Swap** ETH → USDC, then check **Portfolio**.
3. Go to **Admin** (`/admin`), unlock with password `admin123`.
4. Open the **Early Supporter** (whitelist) campaign → **Add my connected wallet**.
5. Back on **Airdrop**, claim it — the IOI tokens land in your portfolio.

## Tech

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4** + the **Pharos v2** design system (CSS-variable tokens, light/dark)
- **Inter Tight** (headlines/body) + **IBM Plex Mono** (chrome/eyebrows/data) via `next/font`
- **Zustand** (with `localStorage` persistence) for all app state
- **Recharts** for price charts · **lucide-react** for icons

Theme is toggled in the navbar and applied before paint (no flash); the saved
preference and all app state persist in the browser. Clear site data to reset.

State persists in the browser, so your wallet, balances, positions, and
admin-created campaigns survive page reloads. Clear site data to reset.

---

_Prototype only — not connected to any live network. Do not use with real funds._
