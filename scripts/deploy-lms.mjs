// Deploy KangLMS (Last Man Standing game) to XPHERE MAINNET — one command.
//
//   1. Fund the deployer with XP gas (~0.2 XP)
//   2. DEPLOYER_PRIVATE_KEY in .env.deploy (gitignored)
//   3. Compile (once):  node scripts/compile-contract.mjs KangLMS
//   4. Deploy:          npm run deploy:lms
//
// Constructor wiring (overridable via env in .env.deploy):
//   LMS_TOKEN     — bet token        (default: KANGTEST1 on Xphere)
//   LMS_TREASURY  — treasury wallet  (default: the fee wallet shown on /games)
//   LMS_BURN      — burn wallet      (default: the burn wallet shown on /games)
//
// The deployer becomes the contract owner (config/pause/withdraw-excess).
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

const xphere = defineChain({
  id: 20250217,
  name: "Xphere Mainnet",
  nativeCurrency: { name: "Xphere", symbol: "XP", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

// KANGTEST1 (Xphere) + the fee wallets already displayed on /games.
const TOKEN = process.env.LMS_TOKEN ?? "0x221b309862ba2d7d01906A743BE1685253698aA8";
const TREASURY = process.env.LMS_TREASURY ?? "0x8d75BD466f1c1998408F81fddC75B9C61Cb2Ab7A";
const BURN = process.env.LMS_BURN ?? "0x3cDab84c91C8974b6A4FdC9bb7CB8fF22f2a6B81";

if (!PK || !/^0x[0-9a-fA-F]{64}$/.test(PK)) {
  console.error("✗ DEPLOYER_PRIVATE_KEY missing/invalid in .env.deploy.");
  process.exit(1);
}
for (const [label, addr] of [["LMS_TOKEN", TOKEN], ["LMS_TREASURY", TREASURY], ["LMS_BURN", BURN]]) {
  if (!isAddress(addr)) {
    console.error(`✗ ${label} is not a valid address: ${addr}`);
    process.exit(1);
  }
}

const artifact = JSON.parse(
  readFileSync(join(__dirname, "..", "contracts", "KangLMS.artifact.json"), "utf8"),
);

const account = privateKeyToAccount(PK);
const transport = http(RPC);
const publicClient = createPublicClient({ chain: xphere, transport });
const walletClient = createWalletClient({ account, chain: xphere, transport });

const chainId = await publicClient.getChainId();
if (chainId !== 20250217) {
  console.error(`✗ RPC is chainId ${chainId}, expected Xphere 20250217`);
  process.exit(1);
}

console.log("Network    : Xphere Mainnet (chainId 20250217)");
console.log("Deployer   :", account.address, "(becomes contract owner)");
console.log("Bet token  :", TOKEN, "(KANGTEST1)");
console.log("Treasury   :", TREASURY);
console.log("Burn wallet:", BURN);

const bal = await publicClient.getBalance({ address: account.address });
console.log("Balance    :", formatEther(bal), "XP");
if (bal === 0n) {
  console.error("✗ 0 XP — fund the deployer first.");
  process.exit(1);
}

console.log("\nDeploying KangLMS…");
const hash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: [TOKEN, TREASURY, BURN],
});
console.log("Tx         :", hash);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) {
  console.error("✗ Deployment failed:", receipt.status);
  process.exit(1);
}

console.log("\n✓ Deployed!");
console.log("Contract   :", receipt.contractAddress);
console.log("Block      :", receipt.blockNumber);
console.log("Explorer   : https://xp.tamsa.io/address/" + receipt.contractAddress);
console.log("\nNext step:");
console.log(`  • Set NEXT_PUBLIC_LMS_CONTRACT=${receipt.contractAddress} in .env.local`);
console.log(`  • Set NEXT_PUBLIC_LMS_DEPLOY_BLOCK=${receipt.blockNumber} (bounds /games event scans)`);
console.log("    (and on Vercel for the deployed app), then restart the dev server.");
