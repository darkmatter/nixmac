#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);
const TOOL_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(TOOL_DIR, "../../..");

export function splitEnvList(value = "") {
  return String(value)
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeRepoPath(filePath) {
  return String(filePath || "")
    .replaceAll(path.sep, "/")
    .replace(/^\.\//, "");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeStoryImportPath(importPath) {
  const normalized = normalizeRepoPath(importPath);
  return normalized.startsWith("src/") ? `apps/native/${normalized}` : normalized;
}

function isStoryFile(filePath) {
  return /\.stories\.(js|jsx|mjs|ts|tsx)$/i.test(filePath);
}

function isUiSourceFile(filePath) {
  const isNativeComponentSource = /^apps\/native\/src\/components\//.test(filePath);
  if (isStoryFile(filePath)) return isNativeComponentSource;
  if (!isNativeComponentSource) return false;
  if (/\/__snapshots__\/|\.test\.|\.spec\.|\.snap$/i.test(filePath)) return false;
  return /\.(css|ts|tsx)$/i.test(filePath);
}

function isNativeRuntimeFile(filePath) {
  return /^(apps\/native\/src-tauri\/|apps\/native\/templates\/|Cargo\.|Cargo\.lock|flake\.|nix\/|ops\/|\.github\/workflows\/build\.yaml)/.test(
    filePath,
  );
}

function isReviewOnlyFile(filePath) {
  return (
    /(^|\/)(README|CHANGELOG|LICENSE)(\.[^/]*)?$/i.test(filePath) ||
    /\.(md|mdx|txt|png|jpe?g|gif|webp|svg)$/i.test(filePath) ||
    /\/(__tests__|__fixtures__|fixtures)\//i.test(filePath) ||
    /\.(test|spec)\.(js|jsx|mjs|ts|tsx)$/i.test(filePath)
  );
}

function isLikelyHelperFile(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  return (
    /^use[A-Z0-9_]/.test(base) ||
    /^(hooks?|utils?|helpers?|types?|constants?|schemas?|fixtures?)$/i.test(base) ||
    /(^|\/)(hooks?|utils?|helpers?|types?|constants?|schemas?|fixtures?)\//i.test(filePath) ||
    /\.(d|types)\.ts$/i.test(filePath)
  );
}

function isComponentEntryPoint(filePath) {
  const normalized = normalizeRepoPath(filePath);
  if (!/\.(ts|tsx)$/i.test(normalized) || isStoryFile(normalized) || isLikelyHelperFile(normalized))
    return false;
  const base = path.basename(normalized, path.extname(normalized));
  const dirBase = path.basename(path.dirname(normalized));
  return base === "index" || base === dirBase || /^[A-Z]/.test(base);
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  visit(dir);
  return out;
}

function storyCandidatesFor(filePath, repoRoot = REPO_ROOT) {
  const normalized = normalizeRepoPath(filePath);
  if (isStoryFile(normalized)) return [normalized];
  const ext = path.extname(normalized);
  const withoutExt = normalized.slice(0, -ext.length);
  const candidates = [
    `${withoutExt}.stories.tsx`,
    `${withoutExt}.stories.ts`,
    `${withoutExt}.stories.jsx`,
    `${withoutExt}.stories.js`,
  ];
  const dir = path.dirname(normalized);
  if (path.basename(withoutExt) === "index") {
    candidates.push(
      ...walk(path.join(repoRoot, dir))
        .map((full) => normalizeRepoPath(path.relative(repoRoot, full)))
        .filter(isStoryFile),
    );
  }
  return [...new Set(candidates)].filter((candidate) => existsSync(path.join(repoRoot, candidate)));
}

function loadStoryIndex(staticDir) {
  const indexPath = path.join(staticDir || "", "index.json");
  if (!staticDir || !existsSync(indexPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(indexPath, "utf8"));
    const entries = Object.values(parsed.entries || {}).filter(
      (entry) => entry?.type === "story" && entry.id,
    );
    return { indexPath, entries };
  } catch {
    return null;
  }
}

function storyUrl(baseUrl, id) {
  if (!baseUrl || !id) return "";
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl.replace(/\/?$/, "/")}index.html${separator}path=/story/${encodeURIComponent(id)}`;
}

function compactStoryEntry(entry, baseUrl) {
  return {
    id: entry.id,
    title: entry.title || "",
    name: entry.name || "",
    importPath: normalizeStoryImportPath(entry.importPath || ""),
    componentPath: normalizeStoryImportPath(entry.componentPath || ""),
    url: storyUrl(baseUrl, entry.id),
  };
}

function appendStory(map, filePath, entry) {
  if (!filePath) return;
  const stories = map.get(filePath) || [];
  stories.push(entry);
  map.set(filePath, stories);
}

function addStoryMatches(matches, strength, source, entries) {
  for (const entry of entries) {
    if (!entry?.id || matches.some((item) => item.entry.id === entry.id)) continue;
    matches.push({ strength, source, entry });
  }
}

function coverageStatusFor(file, matches) {
  if (matches.length) return "covered";
  if (isStoryFile(file) || isComponentEntryPoint(file) || /\.css$/i.test(file))
    return "missing_required_story";
  if (isLikelyHelperFile(file)) return "missing_advisory_story";
  return "missing_required_story";
}

function recommendationFor({
  status,
  uiOnly,
  missingStoryFiles,
  advisoryStoryFiles,
  unknownFiles,
}) {
  if (status === "ready" && uiOnly)
    return "UI-only PR: review the Storybook quick links; native Computer Use was skipped by policy because no native/runtime or unknown files changed.";
  if (status === "ready_with_advisories" && uiOnly)
    return "UI-only PR: Storybook has reviewer links, native Computer Use was skipped, and advisory story gaps are listed for follow-up.";
  if (status === "ready")
    return "Review affected UI in Storybook, then use native Computer Use for changed runtime/native surfaces.";
  if (status === "missing_story")
    return `Add Storybook coverage for ${missingStoryFiles.length} changed UI file(s) before treating the preview as reviewer-ready.`;
  if (status === "build_failed")
    return "Storybook build failed, so the UI preview is not reviewer-ready.";
  if (status === "index_unavailable")
    return "Storybook index.json was unavailable, so direct affected-story links could not be verified.";
  if (status === "invalid_metadata")
    return "Storybook preview metadata was invalid and cannot be trusted.";
  if (unknownFiles.length)
    return "Native Computer Use remains required because changed files include non-UI or unclassified files.";
  if (advisoryStoryFiles.length)
    return "Storybook has reviewer links, with non-blocking advisory story gaps listed for follow-up.";
  return "No Storybook preview is needed for this change set.";
}

export function buildStorybookPreviewPlan({
  env = process.env,
  changedFiles = splitEnvList(env.NIXMAC_E2E_PR_CHANGED_FILES || ""),
  repoRoot = REPO_ROOT,
  staticDir = path.join(REPO_ROOT, "apps/native/storybook-static"),
  baseUrl = env.NIXMAC_E2E_STORYBOOK_BASE_URL || "storybook/",
  buildStatus = env.NIXMAC_E2E_STORYBOOK_BUILD_STATUS || "",
  workflowUrl = env.NIXMAC_E2E_STORYBOOK_WORKFLOW_URL || "",
} = {}) {
  const normalizedChangedFiles = unique(changedFiles.map(normalizeRepoPath));
  const uiFiles = normalizedChangedFiles.filter(isUiSourceFile);
  const nativeRuntimeFiles = normalizedChangedFiles.filter(isNativeRuntimeFile);
  const reviewOnlyFiles = normalizedChangedFiles.filter(
    (file) => !isUiSourceFile(file) && !isNativeRuntimeFile(file) && isReviewOnlyFile(file),
  );
  const unknownFiles = normalizedChangedFiles.filter(
    (file) => !isUiSourceFile(file) && !isNativeRuntimeFile(file) && !isReviewOnlyFile(file),
  );
  const index = loadStoryIndex(staticDir);
  const entries = index?.entries || [];
  const storiesByImportPath = new Map();
  const storiesByComponentPath = new Map();
  for (const entry of entries) {
    appendStory(storiesByImportPath, normalizeStoryImportPath(entry.importPath || ""), entry);
    appendStory(storiesByComponentPath, normalizeStoryImportPath(entry.componentPath || ""), entry);
  }
  const affectedStories = [];
  const missingStoryFiles = [];
  const advisoryStoryFiles = [];
  const coverage = [];

  for (const file of uiFiles) {
    const rawMatches = [];
    const candidates = storyCandidatesFor(file, repoRoot);
    addStoryMatches(
      rawMatches,
      "direct",
      "changed story file or colocated story candidate",
      candidates.flatMap((candidate) => storiesByImportPath.get(candidate) || []),
    );
    addStoryMatches(
      rawMatches,
      "component_path",
      "Storybook componentPath",
      storiesByComponentPath.get(file) || [],
    );
    const matched = rawMatches.map(({ strength, source, entry }) => ({
      ...compactStoryEntry(entry, baseUrl),
      matchStrength: strength,
      matchSource: source,
    }));
    const coverageStatus = coverageStatusFor(file, matched);
    if (matched.length) {
      affectedStories.push({ file, stories: matched });
    } else {
      const gap = {
        file,
        status: coverageStatus,
        expectedStories: candidates.length
          ? candidates
          : [`${file.replace(/\.[^.]+$/, "")}.stories.tsx`],
      };
      if (coverageStatus === "missing_advisory_story") advisoryStoryFiles.push(gap);
      else missingStoryFiles.push(gap);
    }
    coverage.push({
      file,
      status: coverageStatus,
      storyCount: matched.length,
      matchStrengths: unique(matched.map((story) => story.matchStrength)),
    });
  }

  const status = (() => {
    if (!uiFiles.length) return "not_applicable";
    if (buildStatus && buildStatus !== "success") return "build_failed";
    if (!index) return "index_unavailable";
    if (missingStoryFiles.length) return "missing_story";
    if (advisoryStoryFiles.length) return "ready_with_advisories";
    return "ready";
  })();
  const uiOnly = uiFiles.length > 0 && nativeRuntimeFiles.length === 0 && unknownFiles.length === 0;
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    status,
    baseUrl,
    workflowUrl,
    changedFiles: normalizedChangedFiles,
    uiFiles,
    nativeRuntimeFiles,
    reviewOnlyFiles,
    unknownFiles,
    uiOnly,
    affectedStories,
    missingStoryFiles,
    advisoryStoryFiles,
    coverage,
    storyIndex: index
      ? {
          path: normalizeRepoPath(path.relative(repoRoot, index.indexPath)),
          storyCount: entries.length,
        }
      : null,
    recommendation: recommendationFor({
      status,
      uiOnly,
      missingStoryFiles,
      advisoryStoryFiles,
      unknownFiles,
    }),
  };
}

function absoluteStoryUrl(url, baseUrl) {
  if (!url || /^https?:\/\//i.test(url)) return url || "";
  if (!baseUrl) return "";
  const root = baseUrl.replace(/index\.html(?:[?#].*)?$/i, "").replace(/\/?$/, "/");
  return `${root}${url.replace(/^storybook\/(?:index\.html)?/i, "index.html").replace(/^\/+/, "")}`;
}

export function renderStorybookQuickLinks(
  plan,
  { baseUrl = "", maxFiles = 5, maxStories = 2 } = {},
) {
  const lines = [];
  const affected = plan.affectedStories || [];
  if (affected.length) {
    lines.push("- Storybook quick links:");
    for (const item of affected.slice(0, maxFiles)) {
      const links = (item.stories || [])
        .slice(0, maxStories)
        .map((story) => {
          const label = `${story.title || story.id} / ${story.name || story.id}`;
          const href = absoluteStoryUrl(story.url, baseUrl);
          return href ? `[${label}](${href})` : `${label} (hosted URL unavailable)`;
        })
        .join(", ");
      lines.push(`  - \`${item.file}\`: ${links || "no story URL"}`);
    }
    if (affected.length > maxFiles)
      lines.push(`  - ${affected.length - maxFiles} more changed UI file(s) in the hosted report.`);
  }
  if ((plan.missingStoryFiles || []).length) {
    lines.push(
      `- Missing Storybook coverage: ${plan.missingStoryFiles.length} changed UI file(s) need a story before this is reviewer-ready.`,
    );
  }
  if ((plan.advisoryStoryFiles || []).length) {
    lines.push(
      `- Storybook advisories: ${plan.advisoryStoryFiles.length} helper/style file(s) had no direct story; nearby coverage or follow-up may be needed.`,
    );
  }
  if (plan.uiOnly) lines.push("- Native Computer Use: skipped by UI-only Storybook policy.");
  return lines.join("\n");
}

function argValue(args, flag, fallback = "") {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
}

function usage() {
  console.log(`Usage:
  node tests/e2e/computer-use/storybook-preview.mjs plan [--changed-files <file>] [--static-dir <dir>] [--base-url <url>] [--build-status <status>] [--out <json>] [--github-output]
  node tests/e2e/computer-use/storybook-preview.mjs comment --plan <json> [--base-url <url>]
  node tests/e2e/computer-use/storybook-preview.mjs self-test

The plan command maps changed frontend files to built Storybook story URLs.`);
}

function writeGithubOutput(plan) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  writeFileSync(
    output,
    [
      `storybook_has_ui=${plan.uiFiles.length > 0}`,
      `storybook_ui_only=${plan.uiOnly}`,
      `storybook_ready=${plan.status === "ready" || plan.status === "ready_with_advisories"}`,
      `storybook_artifact_ready=${Boolean(plan.storyIndex)}`,
      `storybook_status=${plan.status}`,
      "",
    ].join("\n"),
    { flag: "a" },
  );
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || args.includes("--help") || args.includes("-h")) {
    usage();
    process.exit(command ? 0 : 1);
  }
  if (command === "self-test") {
    runSelfTest();
    return;
  }
  if (command === "comment") {
    const planPath = argValue(args, "--plan", "");
    if (!planPath) throw new Error("comment requires --plan <json>");
    const plan = JSON.parse(readFileSync(path.resolve(REPO_ROOT, planPath), "utf8"));
    console.log(renderStorybookQuickLinks(plan, { baseUrl: argValue(args, "--base-url", "") }));
    return;
  }
  if (command !== "plan") {
    usage();
    process.exit(1);
  }
  const changedFilesArg = argValue(args, "--changed-files", "");
  const plan = buildStorybookPreviewPlan({
    changedFiles: changedFilesArg ? splitEnvList(readFileSync(changedFilesArg, "utf8")) : undefined,
    staticDir: path.resolve(
      REPO_ROOT,
      argValue(args, "--static-dir", "apps/native/storybook-static"),
    ),
    baseUrl: argValue(
      args,
      "--base-url",
      process.env.NIXMAC_E2E_STORYBOOK_BASE_URL || "storybook/",
    ),
    buildStatus: argValue(
      args,
      "--build-status",
      process.env.NIXMAC_E2E_STORYBOOK_BUILD_STATUS || "",
    ),
    workflowUrl: argValue(
      args,
      "--workflow-url",
      process.env.NIXMAC_E2E_STORYBOOK_WORKFLOW_URL || "",
    ),
  });
  const out = argValue(args, "--out", "");
  if (out) {
    const fullOut = path.resolve(REPO_ROOT, out);
    writeFileSync(fullOut, `${JSON.stringify(plan, null, 2)}\n`);
  }
  if (args.includes("--github-output")) writeGithubOutput(plan);
  console.log(JSON.stringify(plan));
}

function runSelfTest() {
  const fixtureRoot = path.join(process.cwd(), "artifacts/computer-use-e2e-storybook-self-test");
  const staticDir = path.join(fixtureRoot, "storybook-static");
  const componentDir = path.join(fixtureRoot, "apps/native/src/components/widget");
  const helperDir = path.join(fixtureRoot, "apps/native/src/components/widget/hooks");
  rmSync(fixtureRoot, { recursive: true, force: true });
  mkdirSync(staticDir, { recursive: true });
  mkdirSync(componentDir, { recursive: true });
  mkdirSync(helperDir, { recursive: true });
  writeFileSync(path.join(componentDir, "Widget.tsx"), "");
  writeFileSync(path.join(componentDir, "Widget.css"), "");
  writeFileSync(path.join(componentDir, "Widget.stories.tsx"), "");
  writeFileSync(path.join(componentDir, "Detail.tsx"), "");
  writeFileSync(path.join(componentDir, "utils.ts"), "");
  writeFileSync(path.join(helperDir, "useWidget.ts"), "");
  writeFileSync(
    path.join(staticDir, "index.json"),
    JSON.stringify({
      entries: {
        "components-widget--default": {
          id: "components-widget--default",
          type: "story",
          title: "Components/Widget",
          name: "Default",
          importPath: "./apps/native/src/components/widget/Widget.stories.tsx",
          componentPath: "./apps/native/src/components/widget/Widget.tsx",
        },
      },
    }),
  );
  const ready = buildStorybookPreviewPlan({
    repoRoot: fixtureRoot,
    staticDir,
    baseUrl: "storybook/",
    buildStatus: "success",
    changedFiles: [
      "apps/native/src/components/widget/Widget.tsx",
      "apps/native/src/components/widget/Widget.css",
      "apps/native/src/components/widget/Widget.stories.tsx",
      "README.md",
    ],
  });
  assert.equal(ready.status, "ready");
  assert.equal(ready.uiOnly, true);
  assert.equal(ready.affectedStories.length, 3);
  assert.equal(ready.unknownFiles.length, 0);
  const advisory = buildStorybookPreviewPlan({
    repoRoot: fixtureRoot,
    staticDir,
    baseUrl: "storybook/",
    buildStatus: "success",
    changedFiles: ["apps/native/src/components/widget/hooks/useWidget.ts"],
  });
  assert.equal(advisory.status, "ready_with_advisories");
  assert.equal(advisory.advisoryStoryFiles.length, 1);
  const basenameHelper = buildStorybookPreviewPlan({
    repoRoot: fixtureRoot,
    staticDir,
    baseUrl: "storybook/",
    buildStatus: "success",
    changedFiles: ["apps/native/src/components/widget/utils.ts"],
  });
  assert.equal(basenameHelper.status, "ready_with_advisories");
  assert.equal(basenameHelper.advisoryStoryFiles.length, 1);
  const outsideStory = buildStorybookPreviewPlan({
    repoRoot: fixtureRoot,
    staticDir,
    baseUrl: "storybook/",
    buildStatus: "success",
    changedFiles: [
      "artifacts/computer-use-e2e-storybook-self-test/apps/native/src/components/widget/Widget.stories.tsx",
    ],
  });
  assert.equal(outsideStory.uiFiles.length, 0);
  assert.equal(outsideStory.status, "not_applicable");
  const missing = buildStorybookPreviewPlan({
    repoRoot: fixtureRoot,
    staticDir,
    baseUrl: "storybook/",
    buildStatus: "success",
    changedFiles: ["apps/native/src/components/widget/Detail.tsx"],
  });
  assert.equal(missing.status, "missing_story");
  assert.equal(missing.uiOnly, true);
  const unknown = buildStorybookPreviewPlan({
    repoRoot: fixtureRoot,
    staticDir,
    baseUrl: "storybook/",
    buildStatus: "success",
    changedFiles: ["apps/native/src/components/widget/Widget.tsx", "package.json"],
  });
  assert.equal(unknown.uiOnly, false);
  const native = buildStorybookPreviewPlan({
    repoRoot: fixtureRoot,
    staticDir,
    baseUrl: "storybook/",
    buildStatus: "success",
    changedFiles: [
      "apps/native/src/components/widget/Widget.tsx",
      "apps/native/src-tauri/src/main.rs",
    ],
  });
  assert.equal(native.uiOnly, false);
  const comment = renderStorybookQuickLinks(ready, {
    baseUrl: "https://example.test/storybook/index.html",
  });
  assert.match(comment, /Storybook quick links/);
  assert.match(comment, /https:\/\/example\.test\/storybook\/index\.html\?path=\/story\//);
  const relativeComment = renderStorybookQuickLinks(ready, { baseUrl: "" });
  assert.doesNotMatch(relativeComment, /\]\(storybook\//);
  assert.match(relativeComment, /hosted URL unavailable/);
  console.log("Storybook preview self-test passed.");
}

if (process.argv[1] && statSync(process.argv[1]).ino === statSync(THIS_FILE).ino) {
  main();
}
