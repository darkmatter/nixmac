import { execa } from "execa";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "src-tauri", "Cargo.toml");
const binariesDir = path.join(root, "src-tauri", "binaries");
const bins = ["nixmac-helper", "nixmac-sync-agent"];

// `tauri build` compiles with MACOSX_DEPLOYMENT_TARGET set to the bundle's
// minimumSystemVersion. This cargo invocation must use the same value, or the
// two builds keep flipping the variable and invalidate the entire dependency
// graph on every run (ring, cc-built C deps, and everything above them).
const tauriConf = JSON.parse(
  await readFile(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"),
);
const minimumSystemVersion = tauriConf.bundle?.macOS?.minimumSystemVersion;
const cargoEnv =
  process.platform === "darwin" && minimumSystemVersion
    ? { MACOSX_DEPLOYMENT_TARGET: minimumSystemVersion }
    : {};

const targetTriple = await rustTargetTriple();
const { stdout: metadataJson } = await execa("cargo", [
  "metadata",
  "--manifest-path",
  manifestPath,
  "--format-version",
  "1",
]);
const metadata = JSON.parse(metadataJson);
const targetDir = metadata.target_directory;

await execa(
  "cargo",
  ["build", "--manifest-path", manifestPath, "--release", ...bins.flatMap((bin) => ["--bin", bin])],
  { stdio: "inherit", env: cargoEnv },
);

await mkdir(binariesDir, { recursive: true });

for (const bin of bins) {
  const source = path.join(targetDir, "release", bin);
  const dest = path.join(binariesDir, `${bin}-${targetTriple}`);
  await copyFile(source, dest);
  console.log(`[sidecars] staged ${dest}`);
}

async function rustTargetTriple() {
  const output = (await execa("rustc", ["-vV"])).stdout;
  const host = output
    .split("\n")
    .find((line) => line.startsWith("host:"))
    ?.slice("host:".length)
    .trim();
  if (!host) {
    throw new Error("Unable to determine rust host target triple");
  }
  return host;
}
