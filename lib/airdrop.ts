// On-chain airdrop helpers — ABI + config for contracts/MerkleAirdrop.sol.
// The contract address comes from env via lib/chain.ts (empty until deployed).
import { AIRDROP_CONTRACT, CHAIN_ID } from "./chain";

export { AIRDROP_CONTRACT, CHAIN_ID };

/** True once a MerkleAirdrop contract address is configured for this network. */
export const airdropLive = AIRDROP_CONTRACT !== "";

/**
 * Sentinel `token` value the contract treats as the native coin (XP): the
 * campaign is funded with msg.value and pays out via call, no ERC-20 involved.
 * MUST match `MerkleAirdrop.NATIVE`.
 */
export const NATIVE_TOKEN =
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;

// Minimal ABI — only what the app calls/reads.
export const AIRDROP_ABI = [
  {
    type: "function",
    name: "createCampaign",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "merkleRoot", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "endsAt", type: "uint64" },
      { name: "amountPerClaim", type: "uint256" },
      { name: "name", type: "string" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "proof", type: "bytes32[]" },
    ],
    outputs: [],
  },
  {
    // Public/open claim — any wallet claims the fixed amountPerClaim once.
    type: "function",
    name: "claimPublic",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    // Owner publishes a whitelist's allocations as an event (data availability)
    // so any visitor can rebuild their proof from the chain.
    type: "function",
    name: "publishWhitelist",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "accounts", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    // Owner replaces a whitelist campaign's Merkle root (grown allocation
    // list) and tops up funding for the added allocations in the same tx.
    type: "function",
    name: "updateRoot",
    stateMutability: "payable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "newRoot", type: "bytes32" },
      { name: "addAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    // Owner pauses/unpauses on-chain claims for a campaign.
    type: "function",
    name: "setActive",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "active_", type: "bool" },
    ],
    outputs: [],
  },
  {
    // Owner force-ends a campaign and sweeps the unclaimed balance to `to`.
    type: "function",
    name: "endAndSweep",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "hasClaimed",
    stateMutability: "view",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    // v5 contracts only — cumulative tokens already claimed per wallet.
    // Reverts (read fails) on the v4 contract; callers must fall back to
    // the boolean hasClaimed above.
    type: "function",
    name: "claimedAmount",
    stateMutability: "view",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    // v6 contracts only — 캠페인 운영 권한(operator). owner 는 항상 통과.
    type: "function",
    name: "operators",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "setOperator",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "remaining",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    // Number of campaigns created so far (ids run 1..campaignCount).
    type: "function",
    name: "campaignCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    // Read a campaign's on-chain state by id.
    type: "function",
    name: "campaigns",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "token", type: "address" },
      { name: "merkleRoot", type: "bytes32" },
      { name: "funded", type: "uint256" },
      { name: "claimed", type: "uint256" },
      { name: "amountPerClaim", type: "uint256" },
      { name: "endsAt", type: "uint64" },
      { name: "active", type: "bool" },
    ],
  },
  {
    type: "event",
    name: "CampaignCreated",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "merkleRoot", type: "bytes32", indexed: false },
      { name: "funded", type: "uint256", indexed: false },
      { name: "endsAt", type: "uint64", indexed: false },
      { name: "amountPerClaim", type: "uint256", indexed: false },
      { name: "name", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "account", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WhitelistPublished",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "accounts", type: "address[]", indexed: false },
      { name: "amounts", type: "uint256[]", indexed: false },
    ],
  },
] as const;
