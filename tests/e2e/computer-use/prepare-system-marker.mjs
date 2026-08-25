#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  buildRemoteRestoreMarker,
  captureRemoteSystemSnapshot,
  cleanupPointersForRunId,
  remoteRestoreMarkerPath,
  remoteRestorePrivilegePreflightCommand,
  remoteRestoreResultPath,
  serializeRemoteRestoreMarker,
  ssh,
} from "./remote-stage.mjs";

function argValue(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? "" : (args[index + 1] ?? "");
}

export async function prepareSystemMarker({
  runId,
  remoteHome,
  outputPath,
  capture = captureRemoteSystemSnapshot,
  execute = ssh,
  now = () => new Date().toISOString(),
  write = writeFile,
} = {}) {
  if (!outputPath) throw new Error("outputPath is required");
  const captured = capture({ requireFormulaAbsent: true });
  if (!captured.snapshot) {
    throw new Error(captured.error || "Remote system precondition snapshot failed");
  }
  const privilegeCheck = execute(remoteRestorePrivilegePreflightCommand(captured.snapshot));
  if (!privilegeCheck.ok) {
    throw new Error(
      privilegeCheck.stderr ||
        privilegeCheck.stdout ||
        "Remote sudo policy does not allow the exact restoration commands",
    );
  }
  const marker = buildRemoteRestoreMarker(captured.snapshot, {
    runId,
    capturedAt: now(),
    cleanup: cleanupPointersForRunId(runId),
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await write(outputPath, serializeRemoteRestoreMarker(marker), "utf8");
  return {
    marker,
    markerPath: remoteRestoreMarkerPath(remoteHome),
    resultPath: remoteRestoreResultPath(remoteHome),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const runId = argValue(args, "--run-id");
  const remoteHome = argValue(args, "--remote-home");
  const outputPath = argValue(args, "--output");
  if (!runId || !remoteHome || !outputPath) {
    throw new Error(
      "usage: prepare-system-marker --run-id <id> --remote-home <path> --output <file>",
    );
  }
  const result = await prepareSystemMarker({ runId, remoteHome, outputPath });
  process.stdout.write(
    `${JSON.stringify({
      runId: result.marker.runId,
      originalSystem: result.marker.originalSystem,
      markerPath: result.markerPath,
      resultPath: result.resultPath,
    })}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
