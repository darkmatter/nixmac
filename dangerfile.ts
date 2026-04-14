import { existsSync, readFileSync } from "node:fs";
import { danger, fail, markdown, message, warn } from "danger";

// ---------------------------------------------------------------------------
// PR snapshot
// ---------------------------------------------------------------------------

const pr = danger.github.pr;
const body = pr.body ?? "";
const title = pr.title ?? "";
const modified = danger.git.modified_files;
const created = danger.git.created_files;
const deleted = danger.git.deleted_files;
const touched = [...modified, ...created];

// ---------------------------------------------------------------------------
// File classifiers
// ---------------------------------------------------------------------------
//
// Only apps/native exists in this repo — the web app lives in
// darkmatter/nixmac-web. No packages/ workspace, no DB migrations,
// no infra/ dir. Secrets are sops-encrypted at ops/secrets/secrets.yaml.

const UI_COMPONENT_RE = /^apps\/native\/src\/components\/.+\.tsx$/;
const STORY_RE = /\.stories\.tsx?$/;
const TS_TEST_RE = /\.(test|spec)\.tsx?$/;
const RUST_SOURCE_RE = /^apps\/native\/src-tauri\/src\/.+\.rs$/;
const TS_LIB_SOURCE_RE = /^apps\/.+\.(ts|tsx)$/;

const isUiComponent = (file: string): boolean =>
  UI_COMPONENT_RE.test(file) && !STORY_RE.test(file) && !TS_TEST_RE.test(file);

const isStory = (file: string): boolean => STORY_RE.test(file);

const isTsTest = (file: string): boolean => TS_TEST_RE.test(file);

const isTsSource = (file: string): boolean =>
  TS_LIB_SOURCE_RE.test(file) &&
  !STORY_RE.test(file) &&
  !TS_TEST_RE.test(file) &&
  !/\.d\.ts$/.test(file) &&
  !/\/(tests?|__tests__|__mocks__)\//.test(file);

const isRustSource = (file: string): boolean =>
  RUST_SOURCE_RE.test(file) && !file.endsWith("/lib.rs") && !file.endsWith("/main.rs");

const matches = (predicate: (file: string) => boolean) => (files: readonly string[]) =>
  files.filter(predicate);

const codeBlock = (files: readonly string[]): string =>
  files.map((f) => `- \`${f}\``).join("\n");

// ---------------------------------------------------------------------------
// Boolean flags — derived once and reused everywhere
// ---------------------------------------------------------------------------

const newUiComponents = matches(isUiComponent)(created);
const newStories = matches(isStory)(created);
const newRustModules = matches(isRustSource)(created);
const newTsSourceFiles = matches(isTsSource)(created);
const newTsTests = matches(isTsTest)(created);

const flags = {
  isDraft: pr.draft === true,
  isWip: /\bWIP\b|^\s*\[wip\]/i.test(title),
  isTrivial: /#trivial\b/i.test(body),
  hasTestPlan:
    /(^|\n)#{2,3}\s*(test plan|testing instructions|how to test)\b/i.test(body),
  hasNewUiComponents: newUiComponents.length > 0,
  hasNewStories: newStories.length > 0,
  hasNewRustModules: newRustModules.length > 0,
  hasNewTsSourceFiles: newTsSourceFiles.length > 0,
  hasNewTsTests: newTsTests.length > 0,
  touchesPackageJson: touched.some((f) => /(^|\/)package\.json$/.test(f)),
  touchesLockfile: touched.some((f) => /(^|\/)bun\.lock$/.test(f)),
  touchesCargo: touched.some((f) => /(^|\/)Cargo\.toml$/.test(f)),
  touchesCargoLock: touched.some((f) => /(^|\/)Cargo\.lock$/.test(f)),
  touchesInfra: touched.some(
    (f) => f.startsWith(".github/workflows/") || f.startsWith("ops/"),
  ),
  touchesSecrets: touched.some((f) => f === "ops/secrets/secrets.yaml"),
} as const;

// ---------------------------------------------------------------------------
// 1. PR overview — booleans rendered as a checklist for reviewers
// ---------------------------------------------------------------------------

function postOverview(): void {
  const tick = (b: boolean) => (b ? "yes" : "no");
  const totalChanges = pr.additions + pr.deletions;

  markdown(`## :clipboard: PR Overview

| | |
| --- | --- |
| Lines changed | **${totalChanges}** (+${pr.additions} / -${pr.deletions}) |
| Files | ${created.length} added, ${modified.length} modified, ${deleted.length} deleted |
| Draft / WIP | ${tick(flags.isDraft || flags.isWip)} |
| Has Test Plan | ${tick(flags.hasTestPlan)} |
| New UI components | ${tick(flags.hasNewUiComponents)} ${flags.hasNewUiComponents ? `(${newUiComponents.length})` : ""} |
| New Storybook stories | ${tick(flags.hasNewStories)} ${flags.hasNewStories ? `(${newStories.length})` : ""} |
| New Rust modules | ${tick(flags.hasNewRustModules)} ${flags.hasNewRustModules ? `(${newRustModules.length})` : ""} |
| New TS source files | ${tick(flags.hasNewTsSourceFiles)} ${flags.hasNewTsSourceFiles ? `(${newTsSourceFiles.length})` : ""} |
| New tests | ${tick(flags.hasNewTsTests)} ${flags.hasNewTsTests ? `(${newTsTests.length})` : ""} |
| package.json touched | ${tick(flags.touchesPackageJson)} |
| Cargo.toml touched | ${tick(flags.touchesCargo)} |
| Infra / CI touched | ${tick(flags.touchesInfra)} |
`);
}

// ---------------------------------------------------------------------------
// 2. New UI components must ship with a Storybook story
// ---------------------------------------------------------------------------

function checkUiComponentStories(): void {
  if (!flags.hasNewUiComponents) {
    return;
  }

  const missing: string[] = [];
  for (const componentPath of newUiComponents) {
    const expectedStory = componentPath.replace(/\.tsx$/, ".stories.tsx");
    const baseName = componentPath
      .split("/")
      .pop()
      ?.replace(/\.tsx$/, "");

    const hasMatchingStory =
      newStories.includes(expectedStory) ||
      (baseName !== undefined &&
        newStories.some((story) =>
          story.toLowerCase().includes(baseName.toLowerCase()),
        ));

    if (!hasMatchingStory) {
      missing.push(componentPath);
    }
  }

  if (missing.length > 0) {
    fail(
      `New UI components were added without a Storybook story. Add a sibling \`*.stories.tsx\` file:\n${codeBlock(missing)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 3. New Rust modules must ship with tests
// ---------------------------------------------------------------------------

function checkRustModuleTests(): void {
  if (!flags.hasNewRustModules) {
    return;
  }

  const missing: string[] = [];
  for (const modulePath of newRustModules) {
    let hasTests = false;

    if (existsSync(modulePath)) {
      const contents = readFileSync(modulePath, "utf8");
      if (/#\[cfg\(test\)\]/.test(contents) || /#\[test\]/.test(contents)) {
        hasTests = true;
      }
    }

    if (!hasTests) {
      const moduleName = modulePath.split("/").pop()?.replace(/\.rs$/, "");
      if (
        moduleName !== undefined &&
        touched.some(
          (f) =>
            f.startsWith("apps/native/src-tauri/tests/") &&
            f.includes(moduleName),
        )
      ) {
        hasTests = true;
      }
    }

    if (!hasTests) {
      missing.push(modulePath);
    }
  }

  if (missing.length > 0) {
    fail(
      `New Rust modules were added without tests. Add a \`#[cfg(test)] mod tests { … }\` block or a file under \`apps/native/src-tauri/tests/\`:\n${codeBlock(missing)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 4. New TS source files should come with tests (warn — softer than UI/Rust)
// ---------------------------------------------------------------------------

function checkNewTsTests(): void {
  if (!flags.hasNewTsSourceFiles || flags.hasNewTsTests) {
    return;
  }

  const uncovered = newTsSourceFiles.filter((f) => !isUiComponent(f));
  if (uncovered.length === 0) {
    return;
  }

  warn(
    `New TypeScript source files were added without any new tests:\n${codeBlock(uncovered)}`,
  );
}

// ---------------------------------------------------------------------------
// 5. Coverage report — surface the v8 summary if it exists
// ---------------------------------------------------------------------------

const COVERAGE_PATHS = ["apps/native/coverage/coverage-summary.json"] as const;

interface CoverageMetric {
  pct: number;
  covered: number;
  total: number;
}

interface CoverageSummary {
  total: {
    lines: CoverageMetric;
    statements: CoverageMetric;
    functions: CoverageMetric;
    branches: CoverageMetric;
  };
}

function reportCoverage(): void {
  const found: { path: string; summary: CoverageSummary }[] = [];

  for (const path of COVERAGE_PATHS) {
    if (!existsSync(path)) {
      continue;
    }
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as CoverageSummary;
      if (parsed.total !== undefined) {
        found.push({ path, summary: parsed });
      }
    } catch {
      warn(`Found a coverage file at \`${path}\` but failed to parse it.`);
    }
  }

  if (found.length === 0) {
    return;
  }

  const rows = found
    .map(({ path, summary }) => {
      const t = summary.total;
      return `| \`${path}\` | ${t.lines.pct.toFixed(1)}% | ${t.statements.pct.toFixed(1)}% | ${t.functions.pct.toFixed(1)}% | ${t.branches.pct.toFixed(1)}% |`;
    })
    .join("\n");

  markdown(`## :microscope: Coverage

| Report | Lines | Statements | Functions | Branches |
| --- | --- | --- | --- | --- |
${rows}
`);
}

// ---------------------------------------------------------------------------
// 6. Test-plan / hygiene / lockfile / debug
// ---------------------------------------------------------------------------

function checkTestPlan(): void {
  if (flags.isTrivial) {
    return;
  }

  if (!flags.hasTestPlan) {
    fail(
      "PR description is missing a `## Test Plan` (or `## Testing Instructions`) section. " +
        "Add one describing how a reviewer can verify your change, or tag the PR `#trivial` if no testing is needed.",
    );
    return;
  }

  const section = body
    .split(/(^|\n)#{2,3}\s*(test plan|testing instructions|how to test)\b/i)
    .pop()
    ?.split(/\n#{2,3}\s/)[0]
    ?.trim();

  if (!section || section.length < 10) {
    fail(
      "Your `## Test Plan` section is empty. Describe the steps a reviewer should take to verify this change.",
    );
  }
}

function checkPrHygiene(): void {
  if (flags.isWip || flags.isDraft) {
    warn("PR is marked WIP / draft — do not merge until ready for review.");
  }
  if (body.length < 30 && !flags.isTrivial) {
    warn("This PR has a very short description. Add some context for reviewers.");
  }
  if (!pr.assignee) {
    warn("Please assign this PR to someone (usually yourself).");
  }
  if (pr.additions + pr.deletions > 500) {
    warn(
      `:exclamation: Big PR (${pr.additions + pr.deletions} lines changed). Consider splitting it into smaller, focused changes.`,
    );
  }
}

function checkLockfiles(): void {
  if (flags.touchesPackageJson && !flags.touchesLockfile) {
    warn(
      "`package.json` changed but `bun.lock` did not. Run `bun install` and commit the lockfile.",
    );
  }
  if (flags.touchesCargo && !flags.touchesCargoLock) {
    warn(
      "`Cargo.toml` changed but `Cargo.lock` did not. Run `cargo build` and commit the lockfile.",
    );
  }
}

function flagInfraAndSecrets(): void {
  if (flags.touchesInfra) {
    const ciChanges = touched.filter(
      (f) => f.startsWith(".github/workflows/") || f.startsWith("ops/"),
    );
    message(
      `:robot: This PR touches CI / infra — reviewers please pay extra attention:\n${codeBlock(ciChanges)}`,
    );
  }
  if (flags.touchesSecrets) {
    warn(
      ":lock: This PR touches `ops/secrets/secrets.yaml`. Confirm the change was made via `sops` and not by hand.",
    );
  }
}

async function checkDebugStatements(): Promise<void> {
  const sourceDiffs = touched.filter(isTsSource);
  for (const file of sourceDiffs) {
    const diff = await danger.git.diffForFile(file);
    if (!diff) {
      continue;
    }
    if (/^\+.*\bconsole\.log\b/m.test(diff.diff)) {
      warn(`\`console.log\` added in \`${file}\` — remove before merging.`);
    }
    if (/^\+.*\bdebugger\b/m.test(diff.diff)) {
      fail(`\`debugger\` statement added in \`${file}\`.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

(async () => {
  postOverview();
  checkTestPlan();
  checkPrHygiene();
  checkUiComponentStories();
  checkRustModuleTests();
  checkNewTsTests();
  checkLockfiles();
  flagInfraAndSecrets();
  reportCoverage();
  await checkDebugStatements();
})();
