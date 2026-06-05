import { createHash } from "crypto";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "bin", "SMTCBridge.cs");
const exePath = resolve(root, "bin", "SMTCBridge.exe");
const monitorPath = resolve(root, "src", "smtc", "SystemMediaMonitor.ts");

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex").toUpperCase();
}

function readConstant(source, name) {
  const match = source.match(new RegExp(`const ${name} = "([A-F0-9]{64})";`));
  if (!match) {
    throw new Error(`Could not find ${name} in SystemMediaMonitor.ts`);
  }
  return match[1];
}

const monitorSource = readFileSync(monitorPath, "utf8");
const actualCsHash = sha256(sourcePath);
const actualExeHash = sha256(exePath);
const knownCsHash = readConstant(monitorSource, "KNOWN_CS_HASH");
const knownExeHash = readConstant(monitorSource, "KNOWN_EXE_HASH");

const failures = [];
if (actualCsHash !== knownCsHash) {
  failures.push(`KNOWN_CS_HASH mismatch: expected ${actualCsHash}, found ${knownCsHash}`);
}
if (actualExeHash !== knownExeHash) {
  failures.push(`KNOWN_EXE_HASH mismatch: expected ${actualExeHash}, found ${knownExeHash}`);
}

if (failures.length) {
  console.error("[verify:smtc] SMTC hash verification failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("[verify:smtc] SMTC hashes are up to date.");
