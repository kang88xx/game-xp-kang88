// Proves the OZ-generated proofs verify under EXACTLY the contract's logic.
//
// We mirror MerkleAirdrop._verify (sorted-pair keccak) and the leaf encoding
// (keccak256(keccak256(abi.encode(address, uint256)))) in plain JS using viem,
// then check OZ proofs pass. If this passes, the on-chain claim() will accept
// the same proofs the frontend generates.
//
//   node scripts/test-merkle.mjs
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { keccak256, encodeAbiParameters, concat } from "viem";

// --- mirror of contract leaf + _verify ---------------------------------------
function leafHash(address, amountWei) {
  const inner = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      // lowercase only to satisfy viem's checksum guard — the encoded 20 bytes
      // are identical regardless of display case.
      [address.toLowerCase(), BigInt(amountWei)],
    ),
  );
  return keccak256(inner); // bytes.concat of a single 32-byte word == that word
}

function verify(proof, root, leaf) {
  let h = leaf;
  for (const p of proof) {
    h = h.toLowerCase() <= p.toLowerCase() ? keccak256(concat([h, p])) : keccak256(concat([p, h]));
  }
  return h.toLowerCase() === root.toLowerCase();
}

// --- test data ---------------------------------------------------------------
const allocs = [
  { address: "0x70b4B19f85041BeA823A72d41f841dC4e028B39D", amountWei: "1000000000000000000000" },
  { address: "0xf2f0aa3b8b8c2d4e5f60718293a4b5c6d7e8f901", amountWei: "500000000000000000000" },
  { address: "0x1111111111111111111111111111111111111111", amountWei: "1" },
  { address: "0x2222222222222222222222222222222222222222", amountWei: "123456789000000000000" },
  { address: "0x3333333333333333333333333333333333333333", amountWei: "42000000000000000000" },
];

const rows = allocs.map((a) => [a.address, a.amountWei]);
const tree = StandardMerkleTree.of(rows, ["address", "uint256"]);
const root = tree.root;
console.log("root:", root);

let pass = 0;
for (const [i, [addr, amt]] of tree.entries()) {
  const proof = tree.getProof(i);
  // 1) our independent leaf hash must equal OZ's internal leaf
  const ozLeaf = tree.leafHash([addr, amt]);
  const ourLeaf = leafHash(addr, amt);
  if (ozLeaf.toLowerCase() !== ourLeaf.toLowerCase()) {
    console.error(`✗ leaf mismatch for ${addr}`);
    process.exit(1);
  }
  // 2) the contract's _verify (mirrored) must accept the proof
  if (!verify(proof, root, ourLeaf)) {
    console.error(`✗ contract-style verify FAILED for ${addr}`);
    process.exit(1);
  }
  pass++;
}
console.log(`✓ ${pass}/${allocs.length} proofs verify under contract logic`);

// 3) negative: wrong amount must NOT verify
const [addr0, amt0] = rows[0];
const badLeaf = leafHash(addr0, BigInt(amt0) + 1n);
const proof0 = tree.getProof(0);
if (verify(proof0, root, badLeaf)) {
  console.error("✗ tampered amount unexpectedly verified");
  process.exit(1);
}
console.log("✓ tampered amount correctly rejected");

// 4) negative: non-member address must NOT verify with any member's proof
const nonMemberLeaf = leafHash("0x9999999999999999999999999999999999999999", "1");
if (verify(proof0, root, nonMemberLeaf)) {
  console.error("✗ non-member unexpectedly verified");
  process.exit(1);
}
console.log("✓ non-member correctly rejected");
console.log("\nALL MERKLE CHECKS PASSED — on-chain claim() will accept frontend proofs.");
