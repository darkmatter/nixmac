// Builds the full sticky PR-comment body (preview link + optional failed
// snapshot gallery) and prints it to stdout for the workflow to PATCH/POST.
//
// Env:
//   MARKER          hidden marker that identifies the sticky comment
//   DEPLOY_URL      Storybook preview URL (Cloudflare Pages)
//   COMMIT_SHA      commit the comment is for
//   SHOTS_BASE_URL  base URL where the harvested screenshots are hosted
//
// Reads test-results/shots/manifest.json when present.

import { readFile } from "node:fs/promises";
import path from "node:path";

const appRoot = path.resolve(import.meta.dirname, "..");
const manifestFile = path.join(appRoot, "test-results", "shots", "manifest.json");

const marker = process.env.MARKER ?? "<!-- nixmac-storybook-preview -->";
const deployUrl = process.env.DEPLOY_URL ?? "";
const commitSha = process.env.COMMIT_SHA ?? "";
const shotsBaseUrl = (process.env.SHOTS_BASE_URL ?? "").replace(/\/+$/, "");

async function readManifest() {
  try {
    return JSON.parse(await readFile(manifestFile, "utf8"));
  } catch {
    return [];
  }
}

const manifest = await readManifest();

const lines = [marker, "### 🎨 Storybook preview", ""];
if (deployUrl) {
  lines.push(`[Open Storybook preview](${deployUrl})`, "");
}
if (commitSha) {
  lines.push(`Updated for ${commitSha}`, "");
}

if (manifest.length > 0) {
  lines.push(
    "---",
    "",
    `### ❌ Failed snapshots (${manifest.length})`,
    "",
    "These stories' HTML snapshots changed. Current renderings (run `bun run test:update-snapshots` and commit if intended):",
    ""
  );
  for (const story of manifest) {
    const label = `${story.title} › ${story.name}`;
    const heading = story.storyUrl ? `[${label}](${story.storyUrl})` : label;
    lines.push(`#### ${heading}`, "");
    if (shotsBaseUrl) {
      lines.push(`![${label}](${shotsBaseUrl}/${story.file})`, "");
    }
  }
}

process.stdout.write(lines.join("\n"));
