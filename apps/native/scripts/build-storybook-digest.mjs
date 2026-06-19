// Builds a reviewer-facing digest of Storybook story changes for the sticky
// PR comment: which stories are new, changed, or removed relative to the PR
// base, each with a deep link into the deployed Storybook preview.
//
// Story changes are derived from the committed snapshot files
// (**/__snapshots__/*.snap) between the merge-base with BASE_REF and HEAD,
// so a story counts as "changed" whenever its rendered HTML changed — even
// when only an underlying component was edited, not the story itself.
//
// Inputs:
//   - env BASE_REF                 git ref of the PR base (e.g. origin/develop)
//   - env DEPLOY_URL               Cloudflare Pages preview base (optional)
//   - storybook-static/index.json  (from `bun run build-storybook`, optional)
//
// Output:
//   - test-results/storybook-digest.md   (consumed by the PR-comment steps;
//     not written when the diff contains no story changes)

import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_ENTRIES_PER_SECTION = 25;
const appRoot = path.resolve(import.meta.dirname, "..");
const indexFile = path.join(appRoot, "storybook-static", "index.json");
const outputFile = path.join(appRoot, "test-results", "storybook-digest.md");

const baseRef = process.env.BASE_REF;
if (!baseRef) {
  console.error("BASE_REF is required (e.g. origin/develop)");
  process.exit(1);
}
const deployUrl = (process.env.DEPLOY_URL ?? "").replace(/\/+$/, "");

function git(...args) {
  return execFileSync("git", args, {
    cwd: appRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function tryGitShow(rev, repoPath) {
  try {
    return git("show", `${rev}:${repoPath}`);
  } catch {
    return "";
  }
}

// Parses a Vitest .snap file into storyName -> concatenated snapshot bodies.
// Keys look like `Story Name 1`; the trailing counter is per-assertion, so
// multiple entries for one story are joined before comparison.
function parseSnapshots(content) {
  const stories = new Map();
  const entryRe = /^exports\[`(.+?)(?: (\d+))?`\] = `((?:[^`\\]|\\[\s\S])*)`;$/gm;
  for (const match of content.matchAll(entryRe)) {
    const [, name, , body] = match;
    stories.set(name, (stories.get(name) ?? "") + body);
  }
  return stories;
}

// __snapshots__/foo.stories.tsx.snap -> foo.stories.tsx (same directory)
function storiesPathForSnap(snapPath) {
  return snapPath.replace(/__snapshots__\//, "").replace(/\.snap$/, "");
}

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

const mergeBase = git("merge-base", baseRef, "HEAD").trim();

// Repo-relative paths of snapshot files that differ from the merge-base.
const diffEntries = [];
const raw = git("diff", "--name-status", "-z", mergeBase, "HEAD");
const fields = raw.split("\0").filter(Boolean);
for (let i = 0; i < fields.length; ) {
  const status = fields[i][0];
  if (status === "R" || status === "C") {
    diffEntries.push({ status: "D", path: fields[i + 1] });
    diffEntries.push({ status: "A", path: fields[i + 2] });
    i += 3;
  } else {
    diffEntries.push({ status, path: fields[i + 1] });
    i += 2;
  }
}
const snapEntries = diffEntries.filter(
  (entry) => entry.path.includes("/__snapshots__/") && entry.path.endsWith(".snap")
);

const added = [];
const removed = [];
const changed = [];

for (const entry of snapEntries) {
  const baseStories = parseSnapshots(
    entry.status === "A" ? "" : tryGitShow(mergeBase, entry.path)
  );
  const headStories = parseSnapshots(
    entry.status === "D" ? "" : tryGitShow("HEAD", entry.path)
  );
  const storiesFile = storiesPathForSnap(entry.path);

  for (const [name, body] of headStories) {
    if (!baseStories.has(name)) {
      added.push({ name, storiesFile });
    } else if (baseStories.get(name) !== body) {
      changed.push({ name, storiesFile });
    }
  }
  for (const name of baseStories.keys()) {
    if (!headStories.has(name)) {
      removed.push({ name, storiesFile });
    }
  }
}

if (added.length + removed.length + changed.length === 0) {
  await rm(outputFile, { force: true });
  console.log("No story changes detected; digest not written.");
  process.exit(0);
}

const index = await readJsonOrDefault(indexFile, { entries: {} });
const storyEntries = Object.values(index.entries ?? {}).filter(
  (entry) => entry.type === "story"
);

// Falls back to the stories filename when the story is absent from the built
// index (always the case for removed stories).
function describe(story) {
  const match = storyEntries.find(
    (entry) => entry.name === story.name && pathsMatch(entry.importPath, story.storiesFile)
  );
  const label = match
    ? `${match.title} › ${match.name}`
    : `${path.basename(story.storiesFile).replace(/\.stories\.\w+$/, "")} › ${story.name}`;
  return match && deployUrl
    ? `[${label}](${deployUrl}/?path=/story/${match.id})`
    : `${label} (\`${story.storiesFile}\`)`;
}

function section(emoji, heading, stories) {
  if (stories.length === 0) return [];
  const shown = stories.slice(0, MAX_ENTRIES_PER_SECTION);
  const lines = [`${emoji} **${heading} (${stories.length})**`, ""];
  for (const story of shown) {
    lines.push(`- ${describe(story)}`);
  }
  if (stories.length > shown.length) {
    lines.push(`- …and ${stories.length - shown.length} more`);
  }
  lines.push("");
  return lines;
}

const baseName = baseRef.replace(/^origin\//, "");
const digest = [
  "---",
  "",
  "### 🧭 Story changes",
  "",
  `Compared to \`${baseName}\` (snapshot diff at story level):`,
  "",
  ...section("🆕", "New stories", added),
  ...section("✏️", "Changed stories", changed),
  ...section("🗑️", "Removed stories", removed),
  "",
  changed.length > 0
    ? "> 💡 [Update snapshots ↗](https://github.com/darkmatter/nixmac/actions/workflows/update-snapshots.yaml) to regenerate baselines and open a PR."
    : "",
].join("\n");

await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, digest);

console.log(
  `Story digest: ${added.length} new, ${changed.length} changed, ` +
    `${removed.length} removed -> ${path.relative(appRoot, outputFile)}`
);
