# Security notes

Cross-audited by Claude + OpenAI Codex (2026-08-18). This records the audit
outcome and the operational rules that keep the **already-deployed** contracts
safe. Deployed bytecode is immutable, so source fixes here only take effect on a
future redeploy — until then the operational rules below are the real controls.

Deployed addresses (Xphere mainnet, see `lib/chain.ts`):

- KangLMS `0xFCa5FC96a94bF6D98eE266de8E811Ed39B737e64`
- MerkleAirdrop `0xFca8cA57D8f3bA44428Ab6bd7CF2960496cA420E`

## Fixed in source (applies on next redeploy)

### `updateRoot` is now owner-only (was operator) — P1

`MerkleAirdrop.updateRoot()` replaces a campaign's Merkle root. The root **is
fund control**: whoever can set it can allocate the whole campaign balance to
their own wallet and `claim()` it, bypassing the owner-only `sweep` /
`endAndSweep` guards. Leaving it `onlyOperator` contradicted the contract's own
"operators can't move funds" design. It is now `onlyOwner`.

**On the currently deployed contract this is NOT yet fixed.** Operational rule:
**do not add any operator you would not trust with the full campaign balance.**
With zero operators (the default) `onlyOperator == owner`, so the live contract
is safe as long as `setOperator` is never called for an untrusted wallet.

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
