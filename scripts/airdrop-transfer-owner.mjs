// Transfer MerkleAirdrop ownership to a new wallet (BSC testnet).
//
//   node scripts/airdrop-transfer-owner.mjs <contractAddress> <newOwner>
//
// Signs with DEPLOYER_PRIVATE_KEY from .env.deploy (current owner). The new
// owner can then createCampaign/sweep. Refuses mainnet.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createWalletClient, createPublicClient, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const raw = readFileSync(join(__dirname, "..", ".env.deploy"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
loadEnv();

const [contract, newOwner] = process.argv.slice(2);
const PK = process.env.DEPLOYER_PRIVATE_KEY;
const RPC =
  process.env.BSC_TESTNET_RPC ?? "https://data-seed-prebsc-1-s1.bnbchain.org:8545";

if (!PK || !/^0x[0-9a-fA-F]{64}$/.test(PK)) {
  console.error("✗ DEPLOYER_PRIVATE_KEY missing/invalid in .env.deploy");
  process.exit(1);
}
if (!isAddress(contract) || !isAddress(newOwner)) {
  console.error("Usage: node scripts/airdrop-transfer-owner.mjs <contract> <newOwner>");
  process.exit(1);
}

const artifact = JSON.parse(
  readFileSync(join(__dirname, "..", "contracts", "MerkleAirdrop.artifact.json"), "utf8"),
);

const account = privateKeyToAccount(PK);
const transport = http(RPC);
const publicClient = createPublicClient({ chain: bscTestnet, transport });
const walletClient = createWalletClient({ account, chain: bscTestnet, transport });

const currentOwner = await publicClient.readContract({
  address: contract,
  abi: artifact.abi,
  functionName: "owner",
});
console.log("Contract     :", contract);
console.log("Current owner:", currentOwner);
console.log("Signer       :", account.address);
console.log("New owner     :", newOwner);

if (currentOwner.toLowerCase() !== account.address.toLowerCase()) {
  console.error("✗ Signer is not the current owner — cannot transfer.");
  process.exit(1);
}

const hash = await walletClient.writeContract({
  address: contract,
  abi: artifact.abi,
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
  address: contract,
  abi: artifact.abi,
  functionName: "owner",
});
console.log("✓ Ownership transferred. New owner:", after);
