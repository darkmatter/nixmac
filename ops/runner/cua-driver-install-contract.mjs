#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { verifyRuntimeObservation } from "./cilicon-e2e-contract.mjs";

const SHA256 = /^sha256:[0-9a-f]{64}$/;

function fail(message) {
  throw new Error(message);
}

function absoluteNormalizedPath(value, field) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.includes("\0") ||
    !path.isAbsolute(value) ||
    path.normalize(value) !== value ||
    value === path.parse(value).root
  ) {
    fail(`${field} must be an absolute normalized path`);
  }
  return value;
}

export async function verifyCuaDriverEntrypoint({ cliSymlink, appExecutable, executableDigest }) {
  absoluteNormalizedPath(cliSymlink, "cliSymlink");
  absoluteNormalizedPath(appExecutable, "appExecutable");
  if (typeof executableDigest !== "string" || !SHA256.test(executableDigest)) {
    fail("executableDigest must be a sha256 digest");
  }
  const metadata = await lstat(cliSymlink);
  if (!metadata.isSymbolicLink()) fail("CuaDriver CLI must be a symbolic link");
  const resolved = await realpath(cliSymlink);
  if (resolved !== appExecutable) {
    fail("CuaDriver symlink target must exactly equal the verified app executable");
  }
  const followedDigest = `sha256:${createHash("sha256")
    .update(await readFile(cliSymlink))
    .digest("hex")}`;
  if (followedDigest !== executableDigest) {
    fail("CuaDriver symlink followed digest must match the verified executable digest");
  }
  return Object.freeze({
    cliSymlink,
    realpath: resolved,
    executableDigest: followedDigest,
  });
}

function parseCli(argv) {
  if (argv[0] !== "verify") fail("usage: cua-driver-install-contract.mjs verify");
  const values = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--contract", "--observation", "--runner-name"].includes(flag) || !value) {
      fail("CuaDriver install verification arguments are invalid");
    }
    values[flag.slice(2)] = value;
  }
  if (Object.keys(values).length !== 3) {
    fail("--contract, --observation, and --runner-name are required");
  }
  return values;
}

async function main(argv) {
  const values = parseCli(argv);
  const contract = JSON.parse(await readFile(values.contract, "utf8"));
  const observation = JSON.parse(await readFile(values.observation, "utf8"));
  const runtime = verifyRuntimeObservation(contract, observation, {
    observedAt: new Date().toISOString(),
  });
  if (runtime.runnerName !== values["runner-name"]) {
    fail("signed runtime runner name does not match GitHub runner identity");
  }
  const verified = await verifyCuaDriverEntrypoint({
    cliSymlink: observation.cuaDriver.cliSymlink,
    appExecutable: observation.cuaDriver.appExecutable,
    executableDigest: observation.cuaDriver.executableDigest,
  });
  process.stdout.write(`${JSON.stringify(verified)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
