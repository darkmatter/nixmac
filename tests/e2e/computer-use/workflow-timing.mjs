#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import process from "node:process";
import {
  formatDuration,
  mergeTimingMetadata,
  normalizeTimingState,
  nowIso,
  recordTimingPhase,
  renderTimingMarkdown,
} from "./timing.mjs";

function usage() {
  console.log(`Usage:
  node tests/e2e/computer-use/workflow-timing.mjs init --file <path> [--note <text>]
  node tests/e2e/computer-use/workflow-timing.mjs start --file <path> --id <id> --label <label> [--category <name>]
  node tests/e2e/computer-use/workflow-timing.mjs end --file <path> --id <id> [--status success|failure|skipped] [--note <text>]
  node tests/e2e/computer-use/workflow-timing.mjs record --file <path> --id <id> --label <label> [--started-at <iso>] [--ended-at <iso>] [--duration-ms <ms>] [--status <status>] [--note <text>] [--observable true|false]
  node tests/e2e/computer-use/workflow-timing.mjs markdown --file <path> [--state <state.json>]
`);
}

function argValue(args, flag, fallback = "") {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
}

function argBoolean(args, flag, fallback) {
  const value = argValue(args, flag, "");
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

async function readTiming(file) {
  if (!existsSync(file)) return normalizeTimingState({});
  return normalizeTimingState(JSON.parse(readFileSync(file, "utf8")));
}

async function writeTiming(file, timing) {
  await mkdir(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(normalizeTimingState(timing), null, 2)}\n`, "utf8");
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || args.includes("--help") || args.includes("-h")) {
    usage();
    process.exit(command ? 0 : 1);
  }
  const file = argValue(args, "--file");
  if (!file) throw new Error(`${command} requires --file <path>`);
  const timing = await readTiming(file);

  if (command === "init") {
    timing.generatedAt = nowIso();
    timing.note =
      argValue(args, "--note") ||
      "Timing phases are best-effort telemetry from the GitHub workflow and Computer Use runner. Unobservable phases are reported explicitly instead of inferred.";
    await writeTiming(file, timing);
    return;
  }

  if (command === "start") {
    const id = argValue(args, "--id");
    if (!id) throw new Error("start requires --id");
    const holder = { timing };
    recordTimingPhase(holder, {
      id,
      label: argValue(args, "--label", id),
      category: argValue(args, "--category", "workflow"),
      source: argValue(args, "--source", "github-actions"),
      status: "in_progress",
      observable: true,
      startedAt: nowIso(),
      note: argValue(args, "--note"),
    });
    await writeTiming(file, holder.timing);
    return;
  }

  if (command === "end") {
    const id = argValue(args, "--id");
    if (!id) throw new Error("end requires --id");
    const existing = timing.phases.find((phase) => phase.id === id) || {
      id,
      label: id,
      category: "workflow",
      source: "github-actions",
    };
    const finalizedPhase = { ...existing };
    delete finalizedPhase.durationMs;
    const holder = { timing };
    recordTimingPhase(holder, {
      ...finalizedPhase,
      endedAt: nowIso(),
      status: argValue(args, "--status", "success"),
      note: argValue(args, "--note", existing.note || ""),
    });
    await writeTiming(file, holder.timing);
    return;
  }

  if (command === "record") {
    const id = argValue(args, "--id");
    if (!id) throw new Error("record requires --id");
    const holder = { timing };
    recordTimingPhase(holder, {
      id,
      label: argValue(args, "--label", id),
      category: argValue(args, "--category", "workflow"),
      source: argValue(args, "--source", "github-actions"),
      status: argValue(args, "--status", "success"),
      observable: argBoolean(args, "--observable", true),
      startedAt: argValue(args, "--started-at"),
      endedAt: argValue(args, "--ended-at"),
      durationMs: argValue(args, "--duration-ms"),
      note: argValue(args, "--note"),
    });
    await writeTiming(file, holder.timing);
    return;
  }

  if (command === "markdown") {
    let merged = timing;
    const statePath = argValue(args, "--state");
    if (statePath && existsSync(statePath)) {
      const state = JSON.parse(readFileSync(statePath, "utf8"));
      mergeTimingMetadata(state, timing);
      merged = state.timing;
    }
    process.stdout.write(renderTimingMarkdown(merged));
    process.stderr.write(
      `Timing summary includes ${merged.phases.length} phases; observed total ${formatDuration(merged.phases.reduce((total, phase) => total + (Number(phase.durationMs) || 0), 0))}.\n`,
    );
    return;
  }

  usage();
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
