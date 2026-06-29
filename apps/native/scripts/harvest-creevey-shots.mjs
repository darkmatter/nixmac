// Collects the screenshots Creevey captured for the failed stories and copies
// them to a flat directory keyed by story ID, plus a manifest the PR-comment
// step consumes.
//
// Creevey writes captures to:
//   test-results/creevey/report/<Title>/<Story Name>/<browser>-actual-<n>.png
// (title segments are split on "/", matching index.json titles like
// "Components/NixEditor").
//
// Inputs:
//   - test-results/failed-stories-resolved.json
//   - test-results/creevey/report/**            (from `creevey test`)
// Output:
//   - test-results/shots/<id>.png
//   - test-results/shots/manifest.json   Array<{ id, name, title, file, storyUrl? }>

import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const appRoot = path.resolve(import.meta.dirname, "..");
const resolvedFile = path.join(appRoot, "test-results", "failed-stories-resolved.json");
const reportDir = path.join(appRoot, "test-results", "creevey", "report");
const shotsDir = path.join(appRoot, "test-results", "shots");

async function readJsonOrDefault(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function findActualPng(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const pngs = entries
    .filter((entry) => entry.isFile() && /actual.*\.png$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  return pngs.length ? path.join(dir, pngs.at(-1)) : null;
}

const resolved = await readJsonOrDefault(resolvedFile, []);
await mkdir(shotsDir, { recursive: true });

const manifest = [];
for (const story of resolved) {
  const storyDir = path.join(reportDir, ...story.title.split("/"), story.name);
  const png = await findActualPng(storyDir);
  if (!png) {
    console.warn(`::warning::No screenshot captured for ${story.title} › ${story.name}`);
    continue;
  }
  const destName = `${story.id}.png`;
  await copyFile(png, path.join(shotsDir, destName));
  manifest.push({
    id: story.id,
    name: story.name,
    title: story.title,
    file: destName,
    ...(story.storyUrl ? { storyUrl: story.storyUrl } : {}),
  });
}

await writeFile(path.join(shotsDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(
  `Harvested ${manifest.length} screenshot${manifest.length === 1 ? "" : "s"} to ${path.relative(appRoot, shotsDir)}.`,
);
