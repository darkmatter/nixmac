// Builds the full sticky PR-comment body (preview link + story-change digest
// + optional failed snapshot gallery) and prints it to stdout for the
// workflow to PATCH/POST.
//
// Env:
//   MARKER          hidden marker that identifies the sticky comment
//   DEPLOY_URL      Storybook preview URL (Cloudflare Pages)
//   COMMIT_SHA      commit the comment is for
//   SHOTS_BASE_URL  base URL where the harvested screenshots are hosted
//
// Reads test-results/shots/manifest.json and test-results/storybook-digest.md
// (from build-storybook-digest.mjs) when present.

import { readFile } from "node:fs/promises";
import path from "node:path";

const appRoot = path.resolve(import.meta.dirname, "..");
const manifestFile = path.join(appRoot, "test-results", "shots", "manifest.json");
const digestFile = path.join(appRoot, "test-results", "storybook-digest.md");

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

async function readDigest() {
  try {
    return await readFile(digestFile, "utf8");
  } catch {
    return "";
  }
}

const manifest = await readManifest();
const digest = await readDigest();

const lines = [marker, "### 🎨 Storybook preview", ""];
if (deployUrl) {
  lines.push(`[Open Storybook preview](${deployUrl})`, "");
}
if (commitSha) {
  lines.push(`Updated for ${commitSha}`, "");
}
if (digest) {
  lines.push(digest.trimEnd(), "");
}

if (manifest.length > 0) {
  lines.push(
    "---",
    "",
    `### ⚠️ Detected UI changes (${manifest.length})`,
    "",
    "These stories' HTML snapshots changed. I've added screenshots + links to the changed stories below. Review them carefully then accept the changes to regenerate baselines and include them in this PR:",
    "",
  );
  for (const story of manifest) {
    const label = `${story.title} › ${story.name}`;
    const heading = story.storyUrl ? `[${label}](${story.storyUrl})` : label;
    lines.push(`#### ${heading}`, "");
    if (shotsBaseUrl) {
      lines.push(`![${label}](${shotsBaseUrl}/${story.file})`, "");
    }
  }
  lines.push(
    "---",
    "",
    "### Accept UI changes",
    "",
    "- [ ] Click here to accept these changes",
    "",
    "Alternatively, you can run `bun run test:update-snapshots` locally to re-generate the baselines and then push the changes to this PR.",
    "",
    "<details>",
    "<summary>What does this do?</summary>",
    "",
    "The screenshots above show UI changes detected by the Storybook",
    "snapshot tests run on this PR. Each image is the rendered output of",
    "a Storybook story from the code in this PR branch; the snapshot",
    "test compared it against the committed baseline in",
    "`__snapshots__/` and flagged the difference.",
    "",
    "Checking the box tells the `darkmatter[bot]` to regenerate the",
    "baselines from this PR's current code and commit them directly to",
    "this branch. The new baselines become the source of truth for",
    "future runs — only accept after confirming the visual changes are",
    "intentional.",
    "",
    "Comparison baseline: the committed `__snapshots__/` files on this",
    "PR branch (carried forward from develop). Accept updates them in",
    "place on this branch.",
    "",
    "</details>",
    "",
  );
}

process.stdout.write(lines.join("\n"));
