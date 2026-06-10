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
// Small batches keep one hung story from consuming most of the workflow budget.
// Override via STORYBOOK_BATCH_SIZE if a runner proves stable enough for more.
const batchSize = Math.max(1, Number(process.env.STORYBOOK_BATCH_SIZE) || 2);
const defaultBatchTimeoutMs = Math.min(30_000 + batchSize * 60_000, 120_000);
const perBatchTimeoutMs =
  Number(process.env.STORYBOOK_BATCH_TIMEOUT_MS) || defaultBatchTimeoutMs;
// Individual retry runs should identify a hung story quickly enough to finish
// before the workflow-level timeout kills the whole job without logs.
const perRetryTimeoutMs = Number(process.env.STORYBOOK_RETRY_TIMEOUT_MS) || 60_000;

// Aggregated record of every story whose snapshot failed, consumed by the
// failed-story screenshot pipeline (scripts/resolve-failed-stories.mjs).
const failedStoriesFile = path.join(appRoot, "test-results", "failed-stories.json");
/** @type {Array<{ file: string, name: string }>} */
const failedStories = [];

class BatchTimeoutError extends Error {}

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

function runVitestForBatch(files, reportPath, timeoutMs = perBatchTimeoutMs) {
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
    }, timeoutMs);

    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      console.log("##[endgroup]");

      if (timedOut) {
        reject(
          new BatchTimeoutError(
            `Timed out after ${timeoutMs / 1000}s while running ${label}`
          )
        );
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

async function runBatchWithTimeoutRetry(files, reportPath, index) {
  try {
    await runVitestForBatch(files, reportPath);
    await collectFailuresFromReport(reportPath, files);
    return true;
  } catch (error) {
    if (error instanceof BatchTimeoutError && files.length > 1) {
      console.error(`::warning::${error.message}; retrying files individually`);
      let allRetriesPassed = true;

      for (const [fileIndex, file] of files.entries()) {
        const retryReportPath = path.join(reportDir, `batch-${index}-retry-${fileIndex}.json`);
        try {
          await runVitestForBatch([file], retryReportPath, perRetryTimeoutMs);
          await collectFailuresFromReport(retryReportPath, [file]);
        } catch (retryError) {
          console.error(`::error::${retryError.message}`);
          allRetriesPassed = false;
          await collectFailuresFromReport(retryReportPath, [file]);
        }

        if (!allRetriesPassed && failedStories.length >= maxFailuresToCollect) {
          break;
        }
      }

      return allRetriesPassed;
    }

    console.error(`::error::${error.message}`);
    await collectFailuresFromReport(reportPath, files);
    return false;
  }
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
    const passed = await runBatchWithTimeoutRetry(storyFileBatch, reportPath, index);
    if (!passed) {
      process.exitCode = 1;
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
