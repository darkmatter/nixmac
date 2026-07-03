// Align the Nix-provided Playwright browsers registry with the revisions the
// installed playwright-core expects.
//
// nixpkgs' playwright-driver.browsers can ship browser revisions that differ
// from upstream playwright's browsers.json for the same driver version (e.g.
// nix ships chromium_headless_shell-1223 while playwright-core 1.59.1 looks
// for chromium_headless_shell-1217). The nix store path is read-only, so we
// build a writable shim directory that symlinks every nix-shipped browser and
// aliases the upstream-expected revision names onto them, then point
// PLAYWRIGHT_BROWSERS_PATH at the shim via GITHUB_ENV.
//
// No-op outside CI-with-nix-browsers: if PLAYWRIGHT_BROWSERS_PATH is unset or
// missing, Playwright's default download registry applies and needs no help.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const src = process.env.PLAYWRIGHT_BROWSERS_PATH;
if (!src || !fs.existsSync(src)) {
  console.log("PLAYWRIGHT_BROWSERS_PATH not set to an existing dir; nothing to align.");
  process.exit(0);
}

// browsers.json is not an exported subpath, and bun's isolated node_modules
// layout only exposes direct dependencies — hop through `playwright` (a
// direct dep) to resolve its `playwright-core` and read the file directly.
const fromScript = createRequire(import.meta.url);
const fromPlaywright = createRequire(fromScript.resolve("playwright"));
const packageRoot = path.dirname(fromPlaywright.resolve("playwright-core"));
const browsersJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "browsers.json"), "utf8"));
const shim = path.join(process.env.RUNNER_TEMP ?? "/tmp", "pw-browsers-shim");
fs.rmSync(shim, { recursive: true, force: true });
fs.mkdirSync(shim, { recursive: true });

const shipped = fs.readdirSync(src);
for (const entry of shipped) {
  fs.symlinkSync(path.join(src, entry), path.join(shim, entry));
}

for (const browser of browsersJson.browsers) {
  const dirName = `${browser.name.replace(/-/g, "_")}-${browser.revision}`;
  const dest = path.join(shim, dirName);
  if (fs.existsSync(dest)) continue;
  const prefix = `${browser.name.replace(/-/g, "_")}-`;
  const candidate = shipped.find((entry) => entry.startsWith(prefix));
  if (candidate) {
    fs.symlinkSync(path.join(src, candidate), dest);
    console.log(`aliased ${dirName} -> ${candidate}`);
  }
}

if (process.env.GITHUB_ENV) {
  fs.appendFileSync(process.env.GITHUB_ENV, `PLAYWRIGHT_BROWSERS_PATH=${shim}\n`);
}
console.log(`PLAYWRIGHT_BROWSERS_PATH -> ${shim}`);
