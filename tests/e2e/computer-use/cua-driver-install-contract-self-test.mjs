#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { verifyCuaDriverEntrypoint } from "../../../ops/runner/cua-driver-install-contract.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "nixmac-cua-driver-contract-"));
try {
  const appExecutable = path.join(root, "CuaDriver.app", "Contents", "MacOS", "cua-driver");
  const wrongExecutable = path.join(root, "forged", "cua-driver");
  const cliSymlink = path.join(root, "bin", "cua-driver");
  await mkdir(path.dirname(appExecutable), { recursive: true });
  await mkdir(path.dirname(wrongExecutable), { recursive: true });
  await mkdir(path.dirname(cliSymlink), { recursive: true });
  await writeFile(appExecutable, "trusted executable\n", { mode: 0o755 });
  await writeFile(wrongExecutable, "forged executable\n", { mode: 0o755 });
  const canonicalAppExecutable = await realpath(appExecutable);
  const executableDigest = `sha256:${createHash("sha256")
    .update("trusted executable\n")
    .digest("hex")}`;

  await symlink(appExecutable, cliSymlink);
  const verified = await verifyCuaDriverEntrypoint({
    cliSymlink,
    appExecutable: canonicalAppExecutable,
    executableDigest,
  });
  assert.equal(verified.realpath, await realpath(appExecutable));
  assert.equal(verified.executableDigest, executableDigest);

  await rm(cliSymlink);
  await symlink(wrongExecutable, cliSymlink);
  await assert.rejects(
    () =>
      verifyCuaDriverEntrypoint({
        cliSymlink,
        appExecutable: canonicalAppExecutable,
        executableDigest,
      }),
    /symlink target must exactly equal the verified app executable/,
    "an executable symlink that points at a different binary must fail before UI execution",
  );

  await rm(cliSymlink);
  await writeFile(cliSymlink, "not a symlink\n", { mode: 0o755 });
  await assert.rejects(
    () =>
      verifyCuaDriverEntrypoint({
        cliSymlink,
        appExecutable: canonicalAppExecutable,
        executableDigest,
      }),
    /must be a symbolic link/,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("CuaDriver install contract self-test passed.");
