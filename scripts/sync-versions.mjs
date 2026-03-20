#!/usr/bin/env node

/**
 * Syncs the version number across all config files after release-it bumps package.json.
 * Called as an after:bump hook by release-it.
 *
 * Files updated:
 *   - apps/native/package.json
 *   - apps/native/src-tauri/tauri.conf.json
 *   - apps/native/src-tauri/Cargo.toml
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/sync-versions.mjs <version>");
  process.exit(1);
}

function updateJson(filePath, mutator) {
  const abs = resolve(root, filePath);
  const data = JSON.parse(readFileSync(abs, "utf-8"));
  mutator(data);
  writeFileSync(abs, JSON.stringify(data, null, 2) + "\n");
  console.log(`  ✅ ${filePath} → ${version}`);
}

function updateToml(filePath) {
  const abs = resolve(root, filePath);
  let content = readFileSync(abs, "utf-8");
  content = content.replace(
    /^(version\s*=\s*)"[^"]*"/m,
    `$1"${version}"`
  );
  writeFileSync(abs, content);
  console.log(`  ✅ ${filePath} → ${version}`);
}

console.log(`Syncing version ${version} across files...`);

updateJson("apps/native/package.json", (d) => {
  d.version = version;
});

updateJson("apps/native/src-tauri/tauri.conf.json", (d) => {
  d.version = version;
});

updateToml("apps/native/src-tauri/Cargo.toml");

console.log("Done.");
