import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const storyRoots = [
  path.resolve(import.meta.dirname, "../src"),
  path.resolve(repoRoot, "packages/ui/src"),
];
const storyFileSuffixes = [".stories.ts", ".stories.tsx"];
const batchSize = 2;
const perBatchTimeoutMs = 120_000;

async function listStoryFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return listStoryFiles(absolutePath);
      }

      if (entry.isFile() && storyFileSuffixes.some((suffix) => entry.name.endsWith(suffix))) {
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

function runVitestForBatch(files) {
  return new Promise((resolve, reject) => {
    const label = files.join(", ");

    console.log(`\n##[group]Storybook snapshot batch: ${label}`);

    let timedOut = false;

    const child = spawn(
      "bunx",
      ["vitest", "run", "--project=storybook", "--no-file-parallelism", "--maxWorkers=1", ...files],
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

try {
  for (const storyFileBatch of batches) {
    await runVitestForBatch(storyFileBatch);
  }
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exitCode = 1;
}
