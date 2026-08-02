// Compile a self-contained Solidity contract to an artifact JSON (abi +
// bytecode) using the solc JS compiler — no Hardhat/Foundry needed.
//
//   node scripts/compile-contract.mjs MerkleAirdrop
//
// Reads  contracts/<Name>.sol
// Writes contracts/<Name>.artifact.json   { abi, bytecode }
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const solc = require("solc");

const __dirname = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2] ?? "MerkleAirdrop";
const srcPath = join(__dirname, "..", "contracts", `${name}.sol`);
const outPath = join(__dirname, "..", "contracts", `${name}.artifact.json`);

const content = readFileSync(srcPath, "utf8");
const fileKey = `${name}.sol`;

const input = {
  language: "Solidity",
  sources: { [fileKey]: { content } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

console.log(`solc ${solc.version()}`);
const output = JSON.parse(solc.compile(JSON.stringify(input)));

const errors = (output.errors ?? []).filter((e) => e.severity === "error");
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}
for (const w of output.errors ?? []) console.warn(w.formattedMessage);

const contract = output.contracts[fileKey][name];
const artifact = {
  contractName: name,
  abi: contract.abi,
  bytecode: "0x" + contract.evm.bytecode.object,
};

writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
console.log(`✓ wrote ${outPath}`);
console.log(`  abi entries: ${artifact.abi.length}`);
console.log(`  bytecode   : ${artifact.bytecode.length} chars`);
