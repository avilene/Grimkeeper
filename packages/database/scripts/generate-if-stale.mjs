#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const hashFile = join(packageRoot, ".prisma-client-hash");
const clientMarker = join(packageRoot, "src/generated/prisma/client.ts");

const inputFiles = ["prisma/schema.prisma", "prisma.config.ts", "package.json"];

function inputsHash() {
  const hash = createHash("sha256");
  for (const relativePath of inputFiles) {
    hash.update(readFileSync(join(packageRoot, relativePath)));
  }
  return hash.digest("hex");
}

function shouldGenerate() {
  if (!existsSync(clientMarker)) {
    return true;
  }
  if (!existsSync(hashFile)) {
    return true;
  }
  return readFileSync(hashFile, "utf8").trim() !== inputsHash();
}

if (!shouldGenerate()) {
  console.log("Prisma client is up to date; skipping prisma generate.");
  process.exit(0);
}

console.log("Prisma inputs changed or client missing; running prisma generate...");
const result = spawnSync("pnpm", ["exec", "prisma", "generate"], {
  cwd: packageRoot,
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

writeFileSync(hashFile, `${inputsHash()}\n`);
