#!/usr/bin/env node
/**
 * Fails if a built macOS bundle links against libraries that only exist on the
 * build machine.
 *
 * A bundle that links e.g. /opt/local/lib (MacPorts) or /opt/homebrew/lib
 * runs fine for whoever built it and dies instantly everywhere else:
 *
 *   dyld[…]: Library not loaded: /opt/local/lib/libiconv.2.dylib
 *
 * This is invisible on the machine that produced it, which is exactly why it
 * needs a mechanical check rather than a code review.
 *
 * Only /usr/lib, /System, and bundle-relative paths (@executable_path, @rpath,
 * @loader_path) are portable. Everything else is a build-host leak.
 *
 * Usage: node scripts/check-bundle-portability.mjs [path/to/App.app]
 * Defaults to the debug bundle; pass a path to check a release build.
 */

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const DEFAULT_APP = resolve(
  import.meta.dirname,
  "../../../target/debug/bundle/macos/nixmac.app",
);

const PORTABLE = [/^\/usr\/lib\//, /^\/System\//, /^@(executable_path|rpath|loader_path)\//];

/** Mach-O dependencies of one binary, minus its own install-name line. */
function linkedLibraries(binary) {
  const output = execFileSync("otool", ["-L", binary], { encoding: "utf8" });
  return output
    .split("\n")
    .slice(1) // first line is the file being inspected
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean);
}

/** Every Mach-O executable/dylib under a bundle's Contents. */
function bundleBinaries(appPath) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      // lstat, not stat: Frameworks/ layouts are full of symlinks, and stat on a
      // broken one throws — which would abort the whole check rather than report
      // it. Symlinks are skipped outright; whatever they point at inside the
      // bundle gets walked on its own.
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile() && (stat.mode & 0o111 || entry.endsWith(".dylib"))) {
        found.push(full);
      }
    }
  };
  walk(join(appPath, "Contents"));
  return found;
}

const appPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_APP;

if (!existsSync(appPath)) {
  console.error(`check:portability — no bundle at ${appPath}`);
  console.error("Build first, or pass a bundle path explicitly.");
  process.exit(1);
}

const violations = [];
for (const binary of bundleBinaries(appPath)) {
  let libs;
  try {
    libs = linkedLibraries(binary);
  } catch {
    continue; // not Mach-O (scripts, resources) — otool refuses, which is fine
  }
  for (const lib of libs) {
    if (!PORTABLE.some((re) => re.test(lib))) {
      violations.push({ binary: binary.slice(appPath.length + 1), lib });
    }
  }
}

if (violations.length > 0) {
  console.error(`\n✗ Non-portable dylib references in ${appPath}:\n`);
  for (const { binary, lib } of violations) {
    console.error(`  ${binary}\n    -> ${lib}`);
  }
  console.error(
    "\nThis bundle will crash on a machine without those paths.\n" +
      "Usual cause: a package-manager prefix (/opt/local, /opt/homebrew) ahead of\n" +
      "the system toolchain on PATH, so pkg-config resolved a dependency there.\n" +
      "Build with that prefix last on PATH and LIBZ_SYS_STATIC=1.\n",
  );
  process.exit(1);
}

console.log(`✓ portable — all dylib references resolve to /usr/lib, /System, or the bundle`);
