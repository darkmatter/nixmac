// Resolves the failed stories recorded by run-storybook-tests-ci.mjs into
// concrete Storybook story IDs + deep links, using the built index.json.
//
// Inputs:
//   - test-results/failed-stories.json   (from the snapshot runner)
//   - storybook-static/index.json        (from `bun run build-storybook`)
//   - env DEPLOY_URL                      (Cloudflare Pages preview base, optional)
//
// Output:
//   - test-results/failed-stories-resolved.json
//       Array<{ id, name, title, importPath, storyUrl? }> capped to MAX_STORIES.
//
// The result is consumed by the Creevey capture step and the PR-comment step.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_STORIES = 5;
const appRoot = path.resolve(import.meta.dirname, "..");
const failedStoriesFile = path.join(appRoot, "test-results", "failed-stories.json");
const indexFile = path.join(appRoot, "storybook-static", "index.json");
const outputFile = path.join(appRoot, "test-results", "failed-stories-resolved.json");
// Negative-lookahead regex over story *names*: Creevey skips every story whose
// name is NOT in the failed set, so only the failed stories get captured.
const skipRegexFile = path.join(appRoot, "test-results", "creevey-skip-regex.txt");

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const deployUrl = (process.env.DEPLOY_URL ?? "").replace(/\/+$/, "");

function stripRelativePrefix(filePath) {
  return filePath.replace(/^(?:\.\.?\/)+/, "").replaceAll("\\", "/");
}

function pathsMatch(importPath, storyFile) {
  const a = stripRelativePrefix(importPath);
  const b = stripRelativePrefix(storyFile);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

async function readJsonOrDefault(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

const failed = await readJsonOrDefault(failedStoriesFile, []);
const index = await readJsonOrDefault(indexFile, { entries: {} });
const storyEntries = Object.values(index.entries ?? {}).filter(
  (entry) => entry.type === "story"
);

const resolved = [];
const seen = new Set();

function pushEntry(entry) {
  if (seen.has(entry.id)) return;
  seen.add(entry.id);
  resolved.push({
    id: entry.id,
    name: entry.name,
    title: entry.title,
    importPath: entry.importPath,
    ...(deployUrl ? { storyUrl: `${deployUrl}/?path=/story/${entry.id}` } : {}),
  });
}

for (const failure of failed) {
  if (resolved.length >= MAX_STORIES) break;

  // File-level failures (timeouts / crashes) have no usable story name, so we
  // surface every story from that file instead.
  const isFileLevel = failure.name.startsWith("(");

  for (const entry of storyEntries) {
    if (resolved.length >= MAX_STORIES) break;
    if (!pathsMatch(entry.importPath, failure.file)) continue;
    if (!isFileLevel && entry.name !== failure.name) continue;
    pushEntry(entry);
  }
}

await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, JSON.stringify(resolved, null, 2));

// Emit the skip regex (empty when nothing to capture, so callers can no-op).
const keepNames = [...new Set(resolved.map((entry) => entry.name))];
const skipRegex = keepNames.length
  ? `^(?!(?:${keepNames.map(escapeRegex).join("|")})$).*$`
  : "";
await writeFile(skipRegexFile, skipRegex);

console.log(
  `Resolved ${resolved.length} failed stor${resolved.length === 1 ? "y" : "ies"} ` +
    `(of ${failed.length} recorded) to ${path.relative(appRoot, outputFile)}.`
);
for (const entry of resolved) {
  console.log(`  - ${entry.title} › ${entry.name} (${entry.id})`);
}
