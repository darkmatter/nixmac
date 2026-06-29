import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";

const appPath = process.argv[2] ?? path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../target/release/bundle/macos/nixmac.app",
);
const nativeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entitlementsPath = path.join(nativeRoot, "src-tauri", "entitlements.plist");
const macosDir = path.join(appPath, "Contents", "MacOS");

await access(appPath);

for (const binary of ["nixmac-helper", "nixmac-sync-agent"]) {
  await execa("codesign", ["--force", "--sign", "-", path.join(macosDir, binary)], {
    stdio: "inherit",
  });
}

await execa(
  "codesign",
  ["--force", "--deep", "--sign", "-", "--entitlements", entitlementsPath, appPath],
  { stdio: "inherit" },
);

await execa("codesign", ["--verify", "--deep", "--strict", "--verbose=4", appPath], {
  stdio: "inherit",
});

console.log(`[sign-local-app] ad-hoc signed and verified ${appPath}`);
