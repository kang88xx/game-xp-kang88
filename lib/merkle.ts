// Merkle tree helpers for the on-chain airdrop (contracts/MerkleAirdrop.sol).
//
// Uses OpenZeppelin's StandardMerkleTree, whose hashing EXACTLY matches the
// contract's _verify:
//   leaf   = keccak256(keccak256(abi.encode(address, uint256)))
//   parent = keccak256(sorted-pair)
//
// Amounts are token base units (wei) as decimal strings so they survive JSON
// (bigint isn't JSON-serializable). Build the tree from a campaign's whitelist
// to get the root (admin → createCampaign) and per-wallet proofs (user → claim).
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

/** One whitelist allocation: address + amount in base units (wei) as string. */
export interface AllocationLeaf {
  address: string;
  amountWei: string;
}

const LEAF_ENCODING = ["address", "uint256"];

function rows(allocs: AllocationLeaf[]): [string, string][] {
  return allocs.map((a) => [a.address, a.amountWei]);
}

/** Merkle root over the allocations (0x-hex). Throws on empty input. */
export function merkleRoot(allocs: AllocationLeaf[]): `0x${string}` {
  const tree = StandardMerkleTree.of(rows(allocs), LEAF_ENCODING);
  return tree.root as `0x${string}`;
}

/**
 * Proof for one claimer. Returns null if the address isn't in the set.
 * Matching is case-insensitive on the address.
 */
export function merkleProof(
  allocs: AllocationLeaf[],
  address: string,
): { amountWei: string; proof: `0x${string}`[] } | null {
  const tree = StandardMerkleTree.of(rows(allocs), LEAF_ENCODING);
  const target = address.toLowerCase();
  for (const [i, [addr, amountWei]] of tree.entries()) {
    if (addr.toLowerCase() === target) {
      return { amountWei, proof: tree.getProof(i) as `0x${string}`[] };
    }
  }
  return null;
}
