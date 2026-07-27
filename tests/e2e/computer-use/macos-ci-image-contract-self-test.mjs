#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const workflow = readFileSync(path.join(repoRoot, ".github/workflows/macos-ci-image.yaml"), "utf8");

const workflowLines = workflow.split("\n");
let runBlockCount = 0;
for (let index = 0; index < workflowLines.length; index += 1) {
  const match = workflowLines[index].match(/^(\s*)run:\s*\|\s*$/);
  if (!match) continue;

  const runIndent = match[1].length;
  const script = [];
  for (index += 1; index < workflowLines.length; index += 1) {
    const line = workflowLines[index];
    if (line.trim() === "") {
      script.push("");
      continue;
    }

    const lineIndent = line.match(/^\s*/)[0].length;
    if (lineIndent <= runIndent) {
      index -= 1;
      break;
    }
    script.push(line.slice(runIndent + 2));
  }

  runBlockCount += 1;
  const result = spawnSync("bash", ["-n"], {
    input: script.join("\n"),
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `workflow run block ${runBlockCount} must pass bash -n:\n${result.stderr}`,
  );
}
assert.ok(runBlockCount >= 9, "expected to syntax-check every workflow run block");

assert.doesNotMatch(
  workflow,
  /then\s*\n\s*fi/,
  "workflow shell must not contain an empty then branch",
);
assert.match(
  workflow,
  /if ! command -v oras[\s\S]*brew install oras/,
  "workflow must install the registry client used to resolve immutable digests",
);
assert.match(
  workflow,
  /tart push nixmac-runner-tahoe[\s\S]*"\$IMAGE:tahoe"[\s\S]*"\$IMAGE:\$TAG"/,
  "one push must publish the stable and traceability tags to the same manifest",
);
assert.match(
  workflow,
  /oras manifest fetch --descriptor "\$IMAGE:\$TAG"[\s\S]*\^sha256:\[0-9a-f\]\{64\}\$/,
  "workflow must resolve and validate the published OCI manifest digest",
);
assert.match(
  workflow,
  /TAHOE_DIGEST=.*oras manifest fetch --descriptor "\$IMAGE:tahoe"[\s\S]*TAHOE_DIGEST.*DIGEST/,
  "workflow must prove both tags resolve to the same manifest",
);
assert.match(
  workflow,
  /echo "image=\$IMAGE@\$DIGEST" >> "\$GITHUB_OUTPUT"[\s\S]*echo "digest=\$DIGEST" >> "\$GITHUB_OUTPUT"/,
  "workflow must expose a digest-qualified image reference and digest",
);
assert.match(
  workflow,
  /image: \$\{\{ steps\.push\.outputs\.image \}\}[\s\S]*digest: \$\{\{ steps\.push\.outputs\.digest \}\}/,
  "job outputs must come from the push step",
);
assert.doesNotMatch(
  workflow,
  /steps\.meta\.outputs/,
  "workflow must not reference a nonexistent metadata step",
);

console.log("macOS CI image contract self-test passed.");
