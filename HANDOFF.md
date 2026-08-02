# Handoff — airdrop on-chain claims (updated 2026-06-11)

Picking up on another device? Start here.

## What shipped (already on `main`)
On-chain airdrop claims that work for every visitor, not just the admin's browser.
- **Public campaigns**: open claim — any wallet claims a fixed amount once via
  `claimPublic(id)`. No proof, no off-chain list.
- **Whitelist campaigns**: allocations are published on-chain as an event
  (`publishWhitelist` → `WhitelistPublished`), so any visitor rebuilds their
  Merkle proof from the chain and claims.
- `/airdrop` reads campaigns straight from the contract (`useOnchainCampaigns`).
- `/admin` launches public + whitelist campaigns on-chain; for launched
  campaigns the Pause button sends a real `setActive` tx and the Delete button
  becomes **즉시 종료 + 미클레임 회수** (`endAndSweep` — force-ends the campaign
  and sweeps the unclaimed balance to the connected owner wallet in one tx).
- `sweep()` only works after a campaign ends; `endAndSweep()` is the explicit
  owner override (added 2026-06-11 — claims stop immediately, so use deliberately).
- **Whitelists grow after launch** (added 2026-06-11): `updateRoot(id, newRoot,
  addAmount)` replaces the Merkle root and tops up funding in one tx. In /admin
  the bulk-entry box stays open after launch — add wallets daily, hit
  **온체인 갱신** (approve delta if needed → updateRoot → republish full list).
  Wallets that already claimed stay claimed (hasClaimed is permanent).
- Security fixes (2026-06-11, commit 0ce2921): analytics swap volume is verified
  on-chain (tx hash required, router + success checked, $1M cap, replay-deduped);
  baseline security headers in `next.config.ts`; login rate limit keys on
  `x-real-ip`; session signing key is bound to ADMIN_PASSWORD + SECRET, so
  rotating either env var revokes all sessions.

Key files: `contracts/MerkleAirdrop.sol`, `lib/airdrop.ts`,
`lib/onchain-campaigns.ts`, `lib/server-rpc.ts`, `app/airdrop/page.tsx`,
`app/admin/page.tsx`.

## Deployed (BSC testnet, chainId 97)
- **MerkleAirdrop (v4, current)**: `0x755f35bf4fa91fda72301d7ce374b710bf87670b`
  — adds `endAndSweep` + `updateRoot`. Explorer:
  https://testnet.bscscan.com/address/0x755f35bf4fa91fda72301d7ce374b710bf87670b
- **Owner** (the only wallet that can launch/sweep): `0x70b4B19F85041bEa823A72D41f841Dc4e028B39D`
- Superseded deploys: v3 `0xbcb655fa…ddbf` (empty), v2 `0xf8e59afa…7464e` and
  v1 `0xa5596ac1…474a9` **still hold test campaigns** — v1 #1: 35k KANG
  (sweepable anytime, v1 has no end-time check), v2 #1: 20M XP (sweepable after
  2026-06-15), v2 #2: 70k KANG left (locked until 2026-09-18). Recover via
  BscScan → Write Contract → `sweep(id, to)` with the owner wallet.

## On the new device
1. Clone the repo, `npm install`.
2. Create `.env.local` (gitignored — NOT in the repo):
   ```
   NEXT_PUBLIC_CHAIN_ENV=testnet
   NEXT_PUBLIC_AIRDROP_TESTNET=0x755f35bf4fa91fda72301d7ce374b710bf87670b
   NEXT_PUBLIC_REOWN_PROJECT_ID=6bb8771e50f8c0efa5fe14c6545c98c2
   ADMIN_PASSWORD=<choose your own — do not commit it>
   ADMIN_SESSION_SECRET=<any 64-hex; generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
   ```
   (The actual password/secret for this machine live only in the local
   `.env.local`, never in git. Reuse them from there, or pick new ones.)
3. `npm run dev` → http://localhost:3000
4. Re-deploying contracts is NOT needed (already deployed). Only if you do, put a
   TESTNET-ONLY `DEPLOYER_PRIVATE_KEY` in `.env.deploy` (gitignored), then run
   `npm run deploy:airdrop` + `node scripts/airdrop-transfer-owner.mjs <contract> <owner>`.

## To launch a campaign on-chain (from /admin)
- Connect the **owner** wallet `0x70b4…B39D` on BSC Testnet.
- That wallet must hold enough of the reward token (KANG `0x9552…` or XP `0x0658…`;
  IOI has no contract so it can't be used).
- Create campaign → "온체인 발행" → approve + createCampaign (whitelist also publishes).
- Pause/resume and 종료+회수 buttons on each launched campaign row send real
  owner transactions (connect the owner wallet first).

## Still open
- Public claim is sybil-farmable by design (open claim). Switch to signature-gated
  if that matters.
- `publishWhitelist` gas scales with list size — split very large whitelists.
- Contract is UNAUDITED. Audit before mainnet.
- At mainnet cutover: bundle Upstash Redis for durable analytics + flip
  `NEXT_PUBLIC_CHAIN_ENV` (see memory/mainnet plan). Always confirm before
  mainnet prod deploys.
