#!/usr/bin/env node

/**
 * Syncs the version number across all native app config files.
 *
 * Usage:
 *   node scripts/sync-versions.mjs <version>   # explicit version (used by release-it hook)
 *   node scripts/sync-versions.mjs             # falls back to root package.json version (used by CI)
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

let version = process.argv[2];
if (!version) {
  // Fallback: read version from root package.json (useful for CI or manual runs)
  const rootPkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
  version = rootPkg.version;
  if (!version) {
    console.error("Error: No version argument provided and no version found in root package.json");
    process.exit(1);
  }
  console.log(`No version argument — using root package.json version: ${version}`);
}

// Basic semver validation (major.minor.patch with optional pre-release)
if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`Error: Invalid version format "${version}" — expected semver (e.g. 1.2.3)`);
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
  const original = readFileSync(abs, "utf-8");
  // Match the first standalone `version = "..."` line (the [package] section)
  const pattern = /^(version\s*=\s*)"[^"]*"/m;
  if (!pattern.test(original)) {
    console.warn(`  ⚠️  ${filePath} — no version field found to update`);
    process.exitCode = 1;
    return;
  }
  const updated = original.replace(pattern, `$1"${version}"`);
  writeFileSync(abs, updated);
  console.log(`  ✅ ${filePath} → ${version}`);
}

console.log(`Syncing version ${version} across native app files...`);

updateJson("apps/native/package.json", (d) => {
  d.version = version;
});

updateJson("apps/native/src-tauri/tauri.conf.json", (d) => {
  d.version = version;
});

updateToml("apps/native/src-tauri/Cargo.toml");

console.log("Done.");
