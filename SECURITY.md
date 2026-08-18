# Security notes

Cross-audited by Claude + OpenAI Codex (2026-08-18). This records the audit
outcome and the operational rules that keep the **already-deployed** contracts
safe. Deployed bytecode is immutable, so source fixes here only take effect on a
future redeploy — until then the operational rules below are the real controls.

Deployed addresses (Xphere mainnet, `NEXT_PUBLIC_*` env in `.env.local` / Vercel):

- KangLMS `0xafbcb897540da09f95c2b9d1dc4514a9a460fb07`
- MerkleAirdrop `0x925a720a1a06e55adb553fee469b3ab47de0326e` (v6-fixed, redeployed 2026-08-18)
  - superseded: `0x01e5120e88b2ae141d49d47ccea8aed9eac8bafd` (updateRoot was operator-callable; had no campaigns/funds)

## Fixed and redeployed on-chain

### `updateRoot` is now owner-only (was operator) — P1 [RESOLVED on-chain]

`MerkleAirdrop.updateRoot()` replaces a campaign's Merkle root. The root **is
fund control**: whoever can set it can allocate the whole campaign balance to
their own wallet and `claim()` it, bypassing the owner-only `sweep` /
`endAndSweep` guards. Leaving it `onlyOperator` contradicted the contract's own
"operators can't move funds" design. It is now `onlyOwner`.

**Redeployed 2026-08-18** to `0x925a720a…0326e` with the fix. Verified on-chain:
a registered operator calling `updateRoot` reverts with `not owner`; the owner
passes the auth check. The old contract `0x01e5120e…bafd` held no campaigns or
funds, so nothing needed migrating. Operators (`0xe0830caB…`, `0xd60196c5…`)
were re-registered on the new contract and now hold operational powers only
(createCampaign with their own funds, publishWhitelist, setActive).

**Action still required:** set `NEXT_PUBLIC_AIRDROP_CONTRACT=0x925a720a…0326e`
in Vercel's project env and redeploy, so production points at the fixed
contract (local `.env.local` is already updated).

## Accepted-by-design risks (know these before running a campaign)

### Public airdrops are sybil-drainable — P2

A public campaign (`merkleRoot == 0`) lets any wallet call `claimPublic()` once.
One person with many wallets can drain it. This is inherent to open claims.

**Rule:** for anything valuable, use a **whitelist** campaign (Merkle root over a
vetted `(address, amount)` list), not a public one. Keep public campaigns small
and treat the whole `funded` amount as "will be taken by whoever is fastest".

### Last-Man-Standing timer is a public-mempool game — P2

The prize goes to the last bettor when `block.timestamp` passes the deadline.
Two consequences that cannot be removed without a redesign (commit-reveal /
private ordering):

1. **Deadline sniping (MEV):** a searcher can back-run an honest near-deadline
   bet to become the last bettor.
2. **Timestamp drift:** a block proposer controls `block.timestamp` within
   consensus tolerance (a few seconds), so bets right at the boundary can be
   nudged in or out.

**Rule:** keep the round timer well above a few seconds. `setTierConfig` allows
`minDuration` as low as 10s — do not run tiers that short. The default 24h /
30s-floor is fine; the drift is negligible against a 30s+ timer. Players should
know "last bet wins" is a public race by design.

## Checked and NOT exploitable

Both auditors independently cleared these:

- **Reentrancy** — `bet`, `settle`, `claimRound`, `claimAll`, and all airdrop
  claims use `nonReentrant` + checks-effects-interactions with pull-payment
  prizes.
- **Settle/claim front-running** — an expired prize is credited to the stored
  `lastBettor`; it cannot be redirected after expiry.
- **Owner rug on LMS** — `withdrawToken` can never touch liabilities
  (`totalPendingPrize + live prizePool`).
- **Owner rug on airdrop** — `sweep`/`endAndSweep` only work on dated campaigns
  after `endsAt`; permanent campaigns (`endsAt == 0`) are non-sweepable.
- **Merkle encoding** — `lib/merkle.ts` matches the contract's double-hashed
  OpenZeppelin StandardMerkleTree leaves (second-preimage safe).
- **Admin auth** — no bypass found. Stateless HMAC session tokens keyed on both
  the session secret and password (rotate either to revoke all sessions),
  one-time nonces bound to session+address, wallet roles re-derived from the
  live allow-list on every privileged call (never trusted from the cookie),
  login rate-limited, and same-origin CSRF checks on all state-changing POSTs.

## Admin operational hygiene

- Set `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` to strong, unique values; both
  gate every admin route. Rotate + redeploy to kill all sessions.
- Never set `ADMIN_DEV_BYPASS=1` in production (it is already ignored unless
  `NODE_ENV === "development"`).
- Keep the contract-owner private keys off any internet-connected machine used
  for day-to-day ops. The owner key is the last line of defense for every
  fund-moving path above.
