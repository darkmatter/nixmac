// Align the Nix-provided Playwright browsers registry with the revisions the
// installed playwright-core expects.
//
// nixpkgs' playwright-driver.browsers can ship browser revisions that differ
// from upstream playwright's browsers.json for the same driver version (e.g.
// nix ships chromium_headless_shell-1223 while playwright-core 1.59.1 looks
// for chromium_headless_shell-1217). The nix store path is read-only, so we
// build a writable shim directory that symlinks every nix-shipped browser and
// aliases the upstream-expected revision names onto them, then point
// PLAYWRIGHT_BROWSERS_PATH at the shim.
//
// Everything that launches browsers (playwright.config.ts, creevey.config.ts,
// vitest.config.ts, scripts/check-playwright-browsers.ts) calls
// alignPlaywrightBrowsers() before launch, so any local or CI entry point
// self-aligns.
//
// No-op outside nix shells: if PLAYWRIGHT_BROWSERS_PATH is unset or missing,
// Playwright's default download registry applies and needs no help.
//
// Related: package.json pins playwright-core as an explicit devDependency
// even though nothing imports it directly. creevey peer-depends on it, and
// without the pin the lockfile can resolve creevey's peer to a stale core
// whose browsers.json expects revisions this shim never aliased — do not
// "clean up" that dep.
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

interface BrowsersJson {
  browsers: Array<{
    name: string;
    revision: string;
    revisionOverrides?: Record<string, string>;
  }>;
}

/**
 * Ensure PLAYWRIGHT_BROWSERS_PATH points at a registry containing the
 * revisions playwright-core expects, building an alias shim if needed.
 * Idempotent and safe to call from concurrently-loading configs.
 *
 * Returns the effective browsers path, or null when no nix-provided registry
 * is configured.
 */
export function alignPlaywrightBrowsers(): string | null {
  const src = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!src || !fs.existsSync(src)) return null;

  // browsers.json is not an exported subpath, and bun's isolated node_modules
  // layout only exposes direct dependencies — hop through `playwright` (a
  // direct dep) to resolve its `playwright-core` and read the file directly.
  const fromScript = createRequire(import.meta.url);
  const fromPlaywright = createRequire(fromScript.resolve("playwright"));
  const packageRoot = path.dirname(fromPlaywright.resolve("playwright-core"));
  const browsersJson: BrowsersJson = JSON.parse(
    fs.readFileSync(path.join(packageRoot, "browsers.json"), "utf8"),
  );

  // Sorted so the shim key and alias candidate picks are deterministic
  // across runtimes (readdir order is not guaranteed).
  const shipped = fs.readdirSync(src).sort();
  const aliases: Array<[dirName: string, candidate: string]> = [];
  for (const browser of browsersJson.browsers) {
    const underscored = browser.name.replace(/-/g, "_");
    // Expected registry dirs: the base revision, plus one
    // `<name>_<platform>_special-<rev>` dir per revisionOverrides entry —
    // playwright-core's readDescriptors resolves to the override dir on
    // matching host platforms (e.g. webkit_mac14_special-2251 on macOS 14).
    const expected = [
      `${underscored}-${browser.revision}`,
      ...Object.entries(browser.revisionOverrides ?? {}).map(
        ([platform, revision]) =>
          `${underscored}_${platform.replace(/-/g, "_")}_special-${revision}`,
      ),
    ];
    const candidate = shipped.find((entry) => entry.startsWith(`${underscored}-`));
    if (!candidate) continue;
    for (const dirName of expected) {
      if (!shipped.includes(dirName)) aliases.push([dirName, candidate]);
    }
  }
  // Every expected revision is shipped as-is: use the nix registry directly.
  if (aliases.length === 0) return src;

  // The shim is keyed by its exact inputs, so an existing directory is always
  // complete and a version bump (npm or nix) naturally lands on a fresh path.
  const key = crypto
    .createHash("sha256")
    .update(JSON.stringify([src, shipped, aliases]))
    .digest("hex")
    .slice(0, 12);
  const shim = path.join(os.tmpdir(), `pw-browsers-shim-${key}`);
  if (!fs.existsSync(shim)) {
    const staging = `${shim}.staging-${process.pid}`;
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    for (const entry of shipped) {
      fs.symlinkSync(path.join(src, entry), path.join(staging, entry));
    }
    for (const [dirName, candidate] of aliases) {
      fs.symlinkSync(path.join(src, candidate), path.join(staging, dirName));
    }
    try {
      fs.renameSync(staging, shim);
    } catch {
      // A concurrently-loading config won the rename; its shim is identical.
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }

  process.env.PLAYWRIGHT_BROWSERS_PATH = shim;
  return shim;
}
