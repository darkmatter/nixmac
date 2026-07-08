import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";

const requiredFiles = [
  "AGENTS.md",
  "ARCHITECTURE.md",
  "docs/README.md",
  "docs/DESIGN.md",
  "docs/FRONTEND.md",
  "docs/PLANS.md",
  "docs/PRODUCT_SENSE.md",
  "docs/QUALITY_SCORE.md",
  "docs/RELIABILITY.md",
  "docs/SECURITY.md",
  "docs/design-docs/index.md",
  "docs/design-docs/core-beliefs.md",
  "docs/design-docs/feature-flags.md",
  "docs/design-docs/adrs/0001-agent-docs-system.md",
  "docs/design-docs/adrs/0002-product-proof-is-advisory.md",
  "docs/design-docs/adrs/0003-main-is-current-trunk.md",
  "docs/design-docs/adrs/0004-git-source-of-truth-review-save.md",
  "docs/design-docs/adrs/0005-orpc-state-and-viewmodel.md",
  "docs/design-docs/adrs/0006-config-tiers-and-secrets.md",
  "docs/design-docs/adrs/0007-semantic-nix-edits-user-intent.md",
  "docs/design-docs/adrs/0008-application-legibility-and-proof-lanes.md",
  "docs/design-docs/adrs/0009-storybook-agent-harness.md",
  "docs/design-docs/adrs/0010-committed-agents-routing.md",
  "docs/design-docs/adrs/0011-evaluation-partition-and-held-out-certification.md",
  "docs/design-docs/adrs/0012-agent-code-quality-guardrails.md",
  "docs/design-docs/adrs/0013-feedback-submission-contract.md",
  "docs/exec-plans/active/harness-engineering.md",
  "docs/exec-plans/completed/historical-index.md",
  "docs/exec-plans/tech-debt-tracker.md",
  "docs/generated/README.md",
  "docs/product-specs/index.md",
  "docs/product-specs/new-user-onboarding.md",
  "docs/product-specs/evolution-agent.md",
  "docs/product-specs/config-and-secrets.md",
  "docs/product-specs/ai-providers.md",
  "docs/product-specs/product-proof.md",
  "docs/product-specs/release-ci.md",
  "docs/references/source-log.md",
  "docs/references/source-partition.md",
  "docs/references/github-app-server-contract.md",
  "docs/references/review-agents/frontend-architect.md",
  "docs/references/review-agents/reliability-engineer.md",
  "docs/references/review-agents/appsec-engineer.md",
  "docs/references/review-agents/product-engineer.md",
];

const requiredAgentsLinks = [
  "ARCHITECTURE.md",
  "docs/FRONTEND.md",
  "docs/product-specs",
  "docs/SECURITY.md",
  "docs/RELIABILITY.md",
  "docs/QUALITY_SCORE.md",
  "docs/PLANS.md",
  "docs/design-docs",
];

const requiredRepoPathReferences = [
  ".cursor/rules/native-config-tiers.mdc",
  ".cursor/rules/native-env.mdc",
  ".cursor/rules/native-errors.mdc",
  ".cursor/rules/native-orpc.mdc",
  ".cursor/rules/native-state-package.mdc",
  ".cursor/rules/ui-directory.mdc",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "apps/native/src/hooks",
  "apps/native/src/hooks/use-flake-exists.ts",
  "apps/native/src/lib/env.ts",
  "apps/native/src/lib/errors.ts",
  "apps/native/src/lib/orpc.ts",
  "apps/native/src/lib/providers/ai-provider-validation.ts",
  "apps/native/src/lib/providers/ai-provider-validation.test.ts",
  "apps/native/src/ipc/orpc-bindings.ts",
  "apps/native/e2e-tauri/tests/wdio",
  "apps/native/src-tauri/prompts/system.md",
  "apps/native/src-tauri/src/orpc",
  "apps/native/src-tauri/src/ai/providers/mod.rs",
  "apps/native/src-tauri/src/evolve/file_ops.rs",
  "apps/native/src-tauri/src/main.rs",
  "apps/native/src-tauri/src/rebuild/darwin.rs",
  "apps/native/src-tauri/src/state/completion_log.rs",
  "dangerfile.ts",
  "packages/state",
  "packages/state/src/onboarding",
  "packages/state/src/ui",
  "packages/state/src/viewmodel",
  "packages/ui/src/components",
  "packages/ui/src/components/ui",
  "tests/e2e/computer-use/ARCHITECTURE.md",
  "tests/e2e/computer-use/OPERATIONS.md",
  "tests/e2e/computer-use/README.md",
];

const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
const quotedStringPattern = /"([^"]+)"/g;
const forbiddenEvaluationBackplayPatterns = [
  {
    name: "quasi-held-out task id",
    pattern: /\bqh-\d{3,}\b/iu,
  },
  {
    name: "historical backplay task id",
    pattern: /\bold-\d{3,}(?:-[a-z0-9]+)*\b/iu,
  },
  {
    name: "synthetic backplay task id",
    pattern: /\bsyn-[a-z0-9]+(?:-[a-z0-9]+)+\b/iu,
  },
  {
    name: "evaluation manifest commit field",
    pattern: /\b(?:answerCommit|baseCommit)\b/iu,
  },
];

const failures = [];

function toRepoPath(path) {
  return normalize(path).split(sep).join("/");
}

function readText(file) {
  return readFileSync(file, "utf8");
}

function assertNonemptyFile(file, label) {
  if (!existsSync(file)) {
    failures.push(`Missing ${label}: ${file}`);
    return;
  }

  if (!pathExistsWithExactCase(file)) {
    failures.push(`${label} has incorrect path casing: ${file}`);
  }

  if (readText(file).trim().length === 0) {
    failures.push(`${label} is empty: ${file}`);
  }
}

function pathExistsWithExactCase(path) {
  const normalizedPath = toRepoPath(path);
  const parts = normalizedPath.split("/").filter(Boolean);
  let current = ".";

  for (const part of parts) {
    if (!existsSync(current)) {
      return false;
    }

    if (!readdirSync(current).includes(part)) {
      return false;
    }

    current = join(current, part);
  }

  return existsSync(current);
}

function walkMarkdownFiles(dir) {
  return walkFiles(dir, (path) => path.endsWith(".md"));
}

function walkFiles(dir, predicate) {
  if (!existsSync(dir)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...walkFiles(path, predicate));
    } else if (predicate(path)) {
      files.push(toRepoPath(path));
    }
  }
  return files;
}

function cleanLinkTarget(rawTarget) {
  const trimmed = rawTarget.trim().replace(/^<|>$/g, "");
  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("mailto:")
  ) {
    return null;
  }

  return trimmed.split("#")[0];
}

function relativeLinksFrom(file) {
  const text = readText(file);
  const links = [];
  for (const match of text.matchAll(markdownLinkPattern)) {
    const target = cleanLinkTarget(match[1]);
    if (target === null || target.length === 0) {
      continue;
    }

    const resolved = toRepoPath(join(dirname(file), target));
    links.push({
      raw: target,
      resolved,
      isMarkdown: target.endsWith(".md"),
    });
  }
  return links;
}

function validateMarkdownLinks(files) {
  for (const file of files) {
    for (const link of relativeLinksFrom(file)) {
      if (!existsSync(link.resolved)) {
        failures.push(`${file} links missing repo target: ${link.raw}`);
      } else if (!pathExistsWithExactCase(link.resolved)) {
        failures.push(`${file} links target with incorrect casing: ${link.raw}`);
      }
    }
  }
}

function validateDocReachability(docFiles) {
  const knownDocs = new Set(docFiles);
  const seen = new Set(["docs/README.md"]);
  const queue = ["docs/README.md"];

  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined) {
      continue;
    }

    for (const link of relativeLinksFrom(file)) {
      if (!link.isMarkdown || !knownDocs.has(link.resolved) || seen.has(link.resolved)) {
        continue;
      }
      seen.add(link.resolved);
      queue.push(link.resolved);
    }
  }

  for (const file of docFiles) {
    if (!seen.has(file)) {
      failures.push(`Docs orphaned from docs/README.md graph: ${file}`);
    }
  }
}

function validateAgentsRouting() {
  if (!existsSync("AGENTS.md")) {
    return;
  }

  const agents = readText("AGENTS.md");
  for (const requiredLink of requiredAgentsLinks) {
    if (!agents.includes(requiredLink)) {
      failures.push(`AGENTS.md does not link ${requiredLink}`);
    }
  }
}

function validateRepoPaths() {
  for (const path of requiredRepoPathReferences) {
    if (!existsSync(path)) {
      failures.push(`Documented repo path is missing: ${path}`);
    }
  }
}

function extractDangerSensitivePaths() {
  if (!existsSync("dangerfile.ts")) {
    failures.push("Missing dangerfile.ts");
    return [];
  }

  const dangerfile = readText("dangerfile.ts");
  const match = dangerfile.match(/const DOCS_SENSITIVE_PATHS = \[([\s\S]*?)\];/m);
  if (match === null) {
    failures.push("dangerfile.ts is missing DOCS_SENSITIVE_PATHS");
    return [];
  }

  const paths = [];
  for (const pathMatch of match[1].matchAll(quotedStringPattern)) {
    paths.push(pathMatch[1]);
  }
  return paths;
}

function validateDangerSensitivePaths() {
  for (const path of extractDangerSensitivePaths()) {
    const filesystemPath = path.endsWith("/") ? path.slice(0, -1) : path;
    if (!existsSync(filesystemPath)) {
      failures.push(`DOCS_SENSITIVE_PATHS references missing path: ${path}`);
    }
  }
}

function validateNoEvaluationBackplayLeakageInText(file, text, targetFailures = failures) {
  for (const { name, pattern } of forbiddenEvaluationBackplayPatterns) {
    const match = text.match(pattern);
    if (match !== null) {
      targetFailures.push(`${file} contains forbidden evaluation/backplay marker (${name}): ${match[0]}`);
    }
  }
}

function validateNoEvaluationBackplayLeakage(files) {
  for (const file of files) {
    validateNoEvaluationBackplayLeakageInText(file, readText(file));
  }
}

function validateEvaluationBackplayLeakageSelfTest() {
  const fixtures = [
    {
      marker: "qh-999",
      text: "This fixture intentionally mentions qh-999 to prove the lint fails.",
    },
    {
      marker: "old-999-example",
      text: "This fixture intentionally mentions old-999-example to prove the lint fails.",
    },
    {
      marker: "syn-example-task",
      text: "This fixture intentionally mentions syn-example-task to prove the lint fails.",
    },
    {
      marker: "answerCommit",
      text: "This fixture intentionally mentions answerCommit to prove the lint fails.",
    },
  ];

  for (const { marker, text } of fixtures) {
    const selfTestFailures = [];
    validateNoEvaluationBackplayLeakageInText("check-agent-docs-self-test.md", text, selfTestFailures);
    if (selfTestFailures.some((failure) => failure.includes(marker))) {
      continue;
    }

    if (selfTestFailures.length > 0) {
      failures.push(...selfTestFailures);
    } else {
      failures.push(`evaluation/backplay leakage self-test did not trigger for ${marker}`);
    }
  }
}

function evaluationBackplayLeakageFiles(docFiles) {
  return [
    "AGENTS.md",
    ".github/copilot-instructions.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ...docFiles,
    ...walkFiles(".cursor/rules", (path) => path.endsWith(".mdc")),
  ].filter((file) => existsSync(file));
}

for (const file of requiredFiles) {
  assertNonemptyFile(file, "required agent doc");
}

const docs = walkMarkdownFiles("docs");
validateMarkdownLinks([
  "AGENTS.md",
  ".agent-runs/README.md",
  ".github/copilot-instructions.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ...walkFiles(".cursor/rules", (path) => path.endsWith(".mdc")),
  ...docs,
].filter((file) => existsSync(file)));
validateDocReachability(docs);
validateAgentsRouting();
validateRepoPaths();
validateDangerSensitivePaths();
validateNoEvaluationBackplayLeakage(evaluationBackplayLeakageFiles(docs));
validateEvaluationBackplayLeakageSelfTest();

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Agent docs check passed (${docs.length} docs).`);
