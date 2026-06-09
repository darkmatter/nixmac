import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const appRoot = path.resolve(import.meta.dirname, "..");
const storyRoots = [
  path.resolve(import.meta.dirname, "../src"),
  path.resolve(repoRoot, "packages/ui/src"),
];
const storyFileSuffixes = [".stories.ts", ".stories.tsx"];
const skippedSnapshotStoryFiles = new Set([
  // React Three Fiber can hang in headless CI WebGL contexts. Keep this story
  // available in Storybook, but exclude it from automated snapshot batches.
  path.resolve(appRoot, "src/components/nixmac-mascot/NixmacMascot3D.stories.tsx"),
]);
// Each batch re-spins a Chromium + reloads the Storybook/Vite env (the big
// "prepare" cost), so larger batches mean fewer restarts and a faster run, at
// the price of more memory held per process. Override via STORYBOOK_BATCH_SIZE.
const batchSize = Math.max(1, Number(process.env.STORYBOOK_BATCH_SIZE) || 6);
// Budget scales with batch size (~60s/file) plus a fixed startup allowance so a
// bigger batch isn't SIGKILLed just for doing more work.
const perBatchTimeoutMs = 30_000 + batchSize * 60_000;

// Aggregated record of every story whose snapshot failed, consumed by the
// failed-story screenshot pipeline (scripts/resolve-failed-stories.mjs).
const failedStoriesFile = path.join(appRoot, "test-results", "failed-stories.json");
/** @type {Array<{ file: string, name: string }>} */
const failedStories = [];

function recordFailure(file, name) {
  const relFile = path.relative(appRoot, path.resolve(file));
  if (!failedStories.some((entry) => entry.file === relFile && entry.name === name)) {
    failedStories.push({ file: relFile, name });
  }
}

// Parse a Vitest JSON report (jest-style) and record every failed assertion as
// a { file, story name } pair. On any parse/IO problem we fall back to marking
// the whole batch's files as failed so screenshots are never silently dropped.
async function collectFailuresFromReport(reportPath, batchFiles) {
  try {
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    for (const testFile of report.testResults ?? []) {
      for (const assertion of testFile.assertionResults ?? []) {
        if (assertion.status === "failed") {
          recordFailure(testFile.name, assertion.title);
        }
      }
    }
  } catch {
    for (const file of batchFiles) {
      recordFailure(file, "(entire file failed)");
    }
  }
}

async function listStoryFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return listStoryFiles(absolutePath);
      }

      if (
        entry.isFile() &&
        storyFileSuffixes.some((suffix) => entry.name.endsWith(suffix)) &&
        !skippedSnapshotStoryFiles.has(absolutePath)
      ) {
        return [path.relative(process.cwd(), absolutePath)];
      }

      return [];
    })
  );

  return files.flat().sort();
}

function chunkFiles(files) {
  const chunks = [];

  for (let index = 0; index < files.length; index += batchSize) {
    chunks.push(files.slice(index, index + batchSize));
  }

  return chunks;
}

function runVitestForBatch(files, reportPath) {
  return new Promise((resolve, reject) => {
    const label = files.join(", ");

    console.log(`\n##[group]Storybook snapshot batch: ${label}`);

    let timedOut = false;

    const child = spawn(
      "bunx",
      [
        "vitest",
        "run",
        "--project=storybook",
        "--no-file-parallelism",
        "--maxWorkers=1",
        "--reporter=default",
        "--reporter=json",
        `--outputFile=${reportPath}`,
        ...files,
      ],
      { stdio: "inherit" }
    );

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill("SIGKILL");
        }
      }, 5_000).unref();
    }, perBatchTimeoutMs);

    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      console.log("##[endgroup]");

      if (timedOut) {
        // No reliable per-story report on a hard timeout; mark the batch wholesale.
        for (const file of files) recordFailure(file, "(timed out)");
        reject(new Error(`Timed out after ${perBatchTimeoutMs / 1000}s while running ${label}`));
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${label} failed with ${signal ?? `exit code ${code}`}`));
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      console.log("##[endgroup]");
      reject(error);
    });
  });
}

const storyFiles = (await Promise.all(storyRoots.map(listStoryFiles))).flat().sort();

if (storyFiles.length === 0) {
  throw new Error(`No Storybook story files found under ${storyRoots.join(", ")}`);
}

const batches = chunkFiles(storyFiles);

console.log(`Running ${storyFiles.length} Storybook snapshot files across ${batches.length} Vitest processes.`);
console.log(`Batch size: ${batchSize} files per Vitest process.`);

// Once enough failures are gathered for the screenshot pipeline (it only
// embeds up to 5), stop early to avoid spending CI time re-running batches —
// the job already fails on exit code, so remaining batches add no signal.
const maxFailuresToCollect = 5;
const reportDir = await mkdtempReportDir();

try {
  for (const [index, storyFileBatch] of batches.entries()) {
    const reportPath = path.join(reportDir, `batch-${index}.json`);
    try {
      await runVitestForBatch(storyFileBatch, reportPath);
    } catch (error) {
      console.error(`::error::${error.message}`);
      process.exitCode = 1;
    } finally {
      await collectFailuresFromReport(reportPath, storyFileBatch);
    }

    if (process.exitCode === 1 && failedStories.length >= maxFailuresToCollect) {
      console.log(
        `\nCollected ${failedStories.length} failures; skipping remaining batches.`
      );
      break;
    }
  }
} finally {
  await mkdir(path.dirname(failedStoriesFile), { recursive: true });
  await writeFile(failedStoriesFile, JSON.stringify(failedStories, null, 2));
  await rm(reportDir, { recursive: true, force: true });
  console.log(
    `\nRecorded ${failedStories.length} failed stor${failedStories.length === 1 ? "y" : "ies"} to ${path.relative(appRoot, failedStoriesFile)}.`
  );
}

async function mkdtempReportDir() {
  const dir = path.join(os.tmpdir(), `storybook-vitest-reports-${process.pid}`);
  await mkdir(dir, { recursive: true });
  return dir;
}
