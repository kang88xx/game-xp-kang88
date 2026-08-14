// Deploy MerkleAirdrop to XPHERE MAINNET — one command, you sign with your key.
//
//   1. Fund the deployer with XP gas (~0.2 XP)
//   2. DEPLOYER_PRIVATE_KEY in .env.deploy (gitignored)
//   3. Compile (once):  npm run compile:airdrop
//   4. Deploy:          npm run deploy:airdrop
//
// The deployer becomes the contract owner (can create/fund campaigns + sweep).
// Campaigns are created on-chain by the OWNER wallet (createCampaign is
// onlyOwner). So the contract owner MUST be the wallet you launch campaigns
// from in the admin panel. If the deployer key differs from that admin wallet,
// set AIRDROP_OWNER to the admin address and this script hands ownership over
// right after deploy (via transferOwnership).
//
// Optional env in .env.deploy:
//   XPHERE_RPC     — RPC override (default: en-bkk.x-phere.com)
//   AIRDROP_OWNER  — final owner address; ownership is transferred here if set
//                    and different from the deployer.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createWalletClient,
  createPublicClient,
  http,
  defineChain,
  formatEther,
  isAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const raw = readFileSync(join(__dirname, "..", ".env.deploy"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // no .env.deploy — fall back to process env
  }
}
loadEnv();

const PK = process.env.DEPLOYER_PRIVATE_KEY;
const RPC = process.env.XPHERE_RPC ?? "https://en-bkk.x-phere.com";
const FINAL_OWNER = process.env.AIRDROP_OWNER;

const xphere = defineChain({
  id: 20250217,
  name: "Xphere Mainnet",
  nativeCurrency: { name: "Xphere", symbol: "XP", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

if (!PK || !/^0x[0-9a-fA-F]{64}$/.test(PK)) {
  console.error("✗ DEPLOYER_PRIVATE_KEY missing/invalid in .env.deploy.");
  process.exit(1);
}
if (FINAL_OWNER && !isAddress(FINAL_OWNER)) {
  console.error(`✗ AIRDROP_OWNER is not a valid address: ${FINAL_OWNER}`);
  process.exit(1);
}

const artifact = JSON.parse(
  readFileSync(join(__dirname, "..", "contracts", "MerkleAirdrop.artifact.json"), "utf8"),
);

const account = privateKeyToAccount(PK);
const transport = http(RPC);
const publicClient = createPublicClient({ chain: xphere, transport });
const walletClient = createWalletClient({ account, chain: xphere, transport });

const chainId = await publicClient.getChainId();
if (chainId !== 20250217) {
  console.error(`✗ Wrong network: chainId ${chainId} (expected 20250217). Check XPHERE_RPC.`);
  process.exit(1);
}

console.log("Network    : Xphere Mainnet (chainId 20250217)");
console.log("Deployer   :", account.address, "(initial contract owner)");
if (FINAL_OWNER && FINAL_OWNER.toLowerCase() !== account.address.toLowerCase()) {
  console.log("Final owner:", FINAL_OWNER, "(ownership transferred after deploy)");
}

const bal = await publicClient.getBalance({ address: account.address });
console.log("Balance    :", formatEther(bal), "XP");
if (bal === 0n) {
  console.error("✗ 0 XP — fund the deployer with XP gas first.");
  process.exit(1);
}

console.log("\nDeploying MerkleAirdrop…");
const hash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: [],
});
console.log("Tx         :", hash);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) {
  console.error("✗ Deployment failed:", receipt.status);
  process.exit(1);
}
const contractAddress = receipt.contractAddress;

console.log("\n✓ Deployed!");
console.log("Contract   :", contractAddress);
console.log("Explorer   : https://xp.tamsa.io/address/" + contractAddress);

// Hand ownership to the admin wallet that will create/fund campaigns.
if (FINAL_OWNER && FINAL_OWNER.toLowerCase() !== account.address.toLowerCase()) {
  console.log("\nTransferring ownership →", FINAL_OWNER, "…");
  const owHash = await walletClient.writeContract({
    address: contractAddress,
    abi: artifact.abi,
    functionName: "transferOwnership",
    args: [FINAL_OWNER],
  });
  const owReceipt = await publicClient.waitForTransactionReceipt({ hash: owHash });
  if (owReceipt.status !== "success") {
    console.error("✗ transferOwnership failed — run it manually before using the admin panel.");
    process.exit(1);
  }
  console.log("✓ Owner is now", FINAL_OWNER);
}

console.log("\nNext step:");
console.log(`  • Set NEXT_PUBLIC_AIRDROP_CONTRACT=${contractAddress} in .env.local`);
console.log("    (and on Vercel for the deployed app), then restart the dev server.");
