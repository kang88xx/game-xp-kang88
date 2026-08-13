// Transfer contract ownership on Xphere mainnet (KangLMS or MerkleAirdrop).
//
//   node scripts/transfer-owner.mjs lms
//   node scripts/transfer-owner.mjs airdrop
//
// Reads from .env.deploy:
//   NEW_OWNER               — the wallet address receiving ownership (required)
//   DEPLOYER_PRIVATE_KEY    — signer; must be the contract's CURRENT owner
//   LMS_OWNER_PRIVATE_KEY   — optional override signer for the `lms` target
//                             (use when the LMS owner differs from the deploy key)
//
// Contract addresses come from .env.local (NEXT_PUBLIC_LMS_CONTRACT /
// NEXT_PUBLIC_AIRDROP_CONTRACT). Prints a summary and refuses to send unless
// the signer matches the on-chain owner.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createWalletClient, createPublicClient, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(file) {
  try {
    const raw = readFileSync(join(__dirname, "..", file), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]])
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
loadEnv(".env.deploy");
loadEnv(".env.local");

const TARGETS = {
  lms: {
    contract: process.env.NEXT_PUBLIC_LMS_CONTRACT,
    pk: process.env.LMS_OWNER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY,
  },
  airdrop: {
    contract: process.env.NEXT_PUBLIC_AIRDROP_CONTRACT,
    pk: process.env.DEPLOYER_PRIVATE_KEY,
  },
};

const target = TARGETS[process.argv[2]];
if (!target) {
  console.error("Usage: node scripts/transfer-owner.mjs <lms|airdrop>");
  process.exit(1);
}

const newOwner = process.env.NEW_OWNER;
if (!newOwner || !isAddress(newOwner)) {
  console.error("✗ NEW_OWNER missing or not a valid address in .env.deploy");
  process.exit(1);
}
if (!target.pk || !/^0x[0-9a-fA-F]{64}$/.test(target.pk)) {
  console.error("✗ signer private key missing/invalid in .env.deploy");
  process.exit(1);
}
if (!target.contract || !isAddress(target.contract)) {
  console.error("✗ contract address missing from .env.local");
  process.exit(1);
}

const RPC = process.env.XPHERE_RPC ?? "https://en-bkk.x-phere.com";
const xphere = {
  id: 20250217,
  name: "Xphere",
  nativeCurrency: { name: "XP", symbol: "XP", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};

// Minimal Ownable surface — both contracts expose owner() + transferOwnership.
const ABI = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "transferOwnership",
    stateMutability: "nonpayable",
    inputs: [{ name: "newOwner", type: "address" }],
    outputs: [],
  },
];

const account = privateKeyToAccount(target.pk);
const transport = http(RPC);
const publicClient = createPublicClient({ chain: xphere, transport });
const walletClient = createWalletClient({ account, chain: xphere, transport });

const currentOwner = await publicClient.readContract({
  address: target.contract,
  abi: ABI,
  functionName: "owner",
});
console.log("Target       :", process.argv[2]);
console.log("Contract     :", target.contract);
console.log("Current owner:", currentOwner);
console.log("Signer       :", account.address);
console.log("New owner    :", newOwner);

if (currentOwner.toLowerCase() !== account.address.toLowerCase()) {
  console.error("✗ Signer is not the current owner — cannot transfer.");
  process.exit(1);
}
if (currentOwner.toLowerCase() === newOwner.toLowerCase()) {
  console.log("✓ Already owned by NEW_OWNER — nothing to do.");
  process.exit(0);
}

const hash = await walletClient.writeContract({
  address: target.contract,
  abi: ABI,
  functionName: "transferOwnership",
  args: [newOwner],
});
console.log("Tx           :", hash);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") {
  console.error("✗ transfer failed");
  process.exit(1);
}
const after = await publicClient.readContract({
  address: target.contract,
  abi: ABI,
  functionName: "owner",
});
console.log("✓ Ownership transferred. New owner:", after);
