# Product Proof E2E Architecture

This document is the in-repo contract for modularizing the Product Proof E2E
lane. It is intentionally scoped to nixmac. Do not extract this toolchain to a
separate repository until there is a second real desktop-app consumer and a
stable generic runner API.

The current production path is the Codex app-server Computer Use lane driven by
`run-remote-cua.mjs`. Future drivers are planned work, not current production
behavior.

## Current Boundary

Keep these in nixmac:

- scenario catalog and evolved-case catalog;
- coverage manifest and managed waivers;
- GitHub workflow wiring, secrets, concurrency, artifact upload, and PR policy;
- no-touch and infra-inconclusive policy;
- report shape and reviewer-facing Product Proof semantics.

The modularization target is an internal set of reviewable modules under
`tests/e2e/computer-use/`, with `run-remote-cua.mjs` staying as the stable
entrypoint until all consumers have migrated. The module sections below describe
target ownership, including responsibilities that have not moved yet.

## Extraction Gate

No module extraction chunk may merge until the preservation harness exists.

The first architecture slice is split into:

1. Architecture spec: this document.
1. Preservation harness: a checked-in fixture or deterministic fixture builder
   plus normalized render/report comparison and adversarial replay wiring.

Chunk 11 and later extraction work is blocked until the second slice lands. A
TODO-only harness is not enough.

## Target Modules

### `scenario-catalog.mjs`

Owns scenario-shaped data:

- scenario labels and groups;
- scenario proof catalog;
- evolved cases;
- screenshot annotations and visual contracts;
- scenario assertion hints;
- curated proof keys;
- supported Homebrew source paths.

This remains the nixmac reference catalog. Do not create a second scenario data
home in a generic package or driver adapter.

### `schemas.mjs` Or `schemas/*.mjs`

Owns non-scenario contracts:

- coverage manifest and waiver shapes;
- no-touch classes;
- evidence grades and evidence-strength values;
- failure taxonomy;
- accessibility-risk values;
- report artifact metadata;
- summary/current-head proof metadata;
- override record shape, once persisted outside PR comments.

Schemas should be importable by the runner, report renderer, fixture harness,
and adversarial tests without starting a remote Mac or Computer Use session.

### `state.mjs`

Owns runtime state creation, migration, persistence, and mutation helpers:

- `baseState`;
- `ensureCurrentSchema`;
- `saveState`;
- `addEvent`;
- `addNarrative`;
- `updateScenario`;
- `refreshVisualProofQuality`;
- historical run migration and render-time backfill.

Render-time historical migration belongs here, not in `report.mjs` or `cli.mjs`.
The current `render-existing` behavior that downgrades historical `discard`
passes, rewrites stale `saveFlow` notes, and re-promotes `discard` when the
stronger save-plus-history-restore path proved cleanup must become an explicit
state migration function.

### `transport.mjs`

Owns current Codex app-server Computer Use transport:

- websocket JSON-RPC setup;
- thread/client lifecycle;
- `get_app_state`, `click`, `set_value`, and screenshot calls;
- AX text parsing;
- element lookup by current index/text-pattern semantics;
- click/set-value failure detection.

This module must not grow future driver behavior. It wraps the current Codex
app-server path. The current path exposes a load-time-validated
`codexAppServerDriverDescriptor` so capability drift breaks locally before a
future adapter pilot depends on it.

### `drivers/contract.mjs`

Owns the explicit in-repo driver contract:

- contract version;
- action-shaped capability keys and required current-runner capabilities;
- built-in element address kinds for the current runner (`codex-index` and
  `text-pattern`);
- descriptor and capability validators;
- `createDriverDescriptor`, which throws on invalid descriptors.

Future adapters must add their own descriptor and tests against this contract
before they are piloted. Address kinds for Appium, AX/Peekaboo, OpenAI API
Computer Use, or Claude Computer Use should be added with those adapters, not
speculated ahead of implementation. Adapter-specific address kinds can be
validated through the contract's explicit extension hook while a reviewed chunk
promotes them to built-in only when they become shared.

### `remote-stage.mjs`

Owns remote Mac setup and metadata helpers:

- SSH/scp command construction;
- staged `.app` and config paths;
- remote report copy-back;
- remote machine/app/process metadata collection;
- readiness handoff data consumed by the report.

`check-remote.mjs` is part of the public readiness/preflight surface. Either it
stays as a separate CLI with its contract frozen, or a future reviewed chunk
moves shared helpers into `remote-stage.mjs` without changing the CLI.

### `visual-proof.mjs`

Owns evidence artifact checks:

- screenshot and text artifact validation;
- ffmpeg/signalstats probes;
- screenshot reel/video creation;
- screenshot annotations and visual assertions;
- secret-masking checks;
- evidence-strength and accessibility-risk derivation when based on artifacts.

The module must expose deterministic helpers for the preservation and
adversarial harnesses. ffmpeg is a host requirement for full visual replay; cases
that synthesize or probe images must either fail with a clear prerequisite error
or be explicitly marked skipped when a local developer runs a reduced harness.

### `report.mjs`

Owns HTML/report rendering:

- `index.html` rendering;
- no-touch/unavailable report rendering;
- report artifact metadata and links;
- report section ordering;
- normalized render signatures for preservation tests.

It must not own scenario state migration. It consumes current state and renders
it.

### `scenario-runner.mjs`

Owns scenario orchestration:

- baseline scenario order;
- evolved-case orchestration;
- destructive boundary policy;
- disposable-config safety checks;
- provider workflow polling flow.

It should call `state.mjs`, `transport.mjs`, `remote-stage.mjs`, and
`visual-proof.mjs` rather than mutate cross-cutting state directly.

### `cli.mjs`

Owns command dispatch while preserving the existing public entrypoints:

- `node tests/e2e/computer-use/run-remote-cua.mjs run`;
- `node tests/e2e/computer-use/run-remote-cua.mjs render-unavailable --note <text>`;
- `node tests/e2e/computer-use/run-remote-cua.mjs render-existing --run-dir <path>`;
- `node tests/e2e/computer-use/run-remote-cua.mjs self-test`.

The wrapper `run-remote-cua.mjs` remains the stable executable path until a
separate reviewed migration changes workflow and README references.

### `drivers/`

Future driver adapters are separate pilots after the Codex path is wrapped and
green through the harness:

- Codex app-server Computer Use;
- OpenAI API Computer Use;
- Claude Computer Use;
- Appium Mac2;
- AX/Peekaboo.

The first driver interface must model capabilities, not just method names:

- connect or attach;
- get visible app state;
- find element by address;
- click;
- set value or type;
- capture screenshot/text proof;
- wait/poll;
- teardown;
- driver metadata and capability reporting.

Element addresses currently support the real Codex app-server index and
text-pattern model. Future selector, coordinate, accessibility id/path, and API
driver-native forms belong in the adapter chunks that exercise them; do not
force future adapters into Codex app-server index semantics, and do not freeze
unproven shapes before a driver uses them.

## Public CLI Contracts

### `run-remote-cua.mjs run`

Workflow production command. It launches the remote Product Proof suite, writes
the run directory under `artifacts/computer-use-remote/<timestamp>/`, renders
`index.html`, `state.json`, `events.json`, screenshots, text snapshots, video
when available, and remote metadata.

The command exits non-zero when the final verdict is `fail` or `inconclusive`
unless `NIXMAC_E2E_STRICT_VERDICT=false` is set.

### `run-remote-cua.mjs render-unavailable`

Workflow no-touch command for remote-unavailable or setup-blocked paths.
Workflow-required flags:

- `--note <text>`;

Supported flags:

- `--run-dir <path>`.

The CLI currently defaults `--note` when omitted, but workflow and operator paths
should pass an explicit note. It must create a report without touching app state
and mark scenarios inconclusive with the supplied/defaulted note.

### `run-remote-cua.mjs render-existing`

Adversarial and report-regeneration command. Required flags:

- `--run-dir <path>`.

It reads `<run-dir>/state.json`, migrates it through current schema and
historical-state rules, renders `<run-dir>/index.html`, and writes
`<run-dir>/state.regenerated.json`.

`state.regenerated.json` is a stable cross-tool artifact. `run-adversarial.mjs`
depends on this exact name. Do not rename it without migrating adversarial and
documented callers in the same reviewed chunk.

### `run-remote-cua.mjs self-test`

Workflow preflight command. It must remain local-only and must not require a
remote Mac, Computer Use websocket, secrets, or network.

It should cover parser helpers, PR focus mapping, visual probe math, report
rendering anchors, duplicate-id checks, crash fallback rendering, and any helper
that gets extracted into shared modules.

### `check-remote.mjs`

Readiness/preflight CLI. Current stable command:

```bash
node tests/e2e/computer-use/check-remote.mjs --host <fqdn-or-ip> [options]
```

Stable flags:

- `--user <user>`;
- `--key <path>`;
- `--known-hosts <path>`;
- `--json <path>`;
- `--port <port>`;
- `--expected-local-hostname <name>`;
- `--check-app-path <path>`;
- `--check-codex-binary`;
- `--check-computer-use-plugin`;
- `--check-recording-tools`;
- `--require-app-server <port>`.

Workflow-tested failure contracts:

- invalid `--require-app-server` exits with usage error and stderr containing
  `Invalid --require-app-server`;
- SSH-dependent checks without `--user` exit with usage error and stderr
  containing `SSH-dependent checks require --user`;
- TCP failure JSON keeps `.ok == false` and includes a failed check with
  `name == "tcp"` and `status == "fail"`.

Do not refactor these strings or JSON shapes as incidental cleanup.

## Report And State Contracts

The primary run artifacts are:

- `index.html`;
- `state.json`;
- `events.json`;
- `state.regenerated.json` for regenerated runs;
- `screenshots/*` when safe to store;
- `texts/*`;
- `video/computer-use-evidence.mp4` when screenshot reel creation succeeds;
- remote readiness and metadata JSON artifacts when supplied by workflow.

`summarize-runs.mjs` is an offline consumer of these artifacts. It may read
`state.json` and `events.json` from local artifact roots to produce operator
rollups, but it must not mutate run state, call GitHub, contact DXU, or promote
local files into gate truth. Summary metrics use `state.v2.scenarioContracts` as
the primary scenario source, with a legacy fallback to `state.scenarios` only
for older preserved runs.

`OPERATIONS.md` is the operator playbook for running the lane. It should link to
`README.md` for policy rather than duplicating promotion, override, or
infra-class semantics.

`state.v2.scenarioContracts` is a preservation-sensitive contract. The
preservation harness must compare a normalized subset with explicit equality
semantics:

- byte-equal: scenario keys, labels, statuses, legacy evidence grades, evidence
  strength values, failure classes, accessibility risk values, assertion types,
  visual assertion status, proof text, and limitation text;
- normalized text: reason fields, notes, and evidence strings after timestamp,
  run id, absolute path, and regenerated-at removal;
- ignored or separately asserted: known nondeterministic timestamps, machine
  identity, process ids, remote temp paths, run directory names, and
  `regeneratedAt`.

Primary artifact labels and paths are not currently fields on each
`scenarioContracts` entry. The harness must compare linked screenshot/text
artifact records separately through scenario proof data and `state.screenshots`
or `state.textSnapshots`, after path normalization.

Any change to this equality policy is a schema change and must be called out in
the PR.

## Sibling Runner Contracts

### `run-adversarial.mjs`

Downstream consumer of `render-existing`, `state.json`, `index.html`, and
`state.regenerated.json`.

It currently copies a baseline
`artifacts/computer-use-remote/<timestamp>/` run, mutates state/artifacts, calls
`run-remote-cua.mjs render-existing --run-dir <caseDir>`, and verifies the
renderer/reporting layer catches false-green evidence.

The preservation harness must be compatible with this flow. If adversarial moves
from CLI execution to module imports, that migration must happen in the same
reviewed chunk as the CLI change.

`run-adversarial.mjs` requires ffmpeg for fixtures that synthesize blank images.
Local reduced harness runs may skip those cases only when the skip is explicit
in the aggregate report.

### `run-local.mjs`

Sibling local/manual harness. It currently has its own divergent
`scenarioLabels` map. Some keys are local-only or older semantic names
(`settings`, `suggestion`, `descriptor`, `buildCheck`) rather than a clean subset
of `scenario-catalog.mjs`. That duplication is intentional only until the
catalog/schema consolidation chunk.

The consolidation chunk must choose one of two outcomes:

1. reconcile local-only keys, import the shared catalog, and declare local subset
   or local-extension semantics; or
1. keep a local-only map with a self-test that fails when shared scenario names
   drift without an explicit local exception.

The architecture claim that `scenario-catalog.mjs` is the single scenario-shaped
data home is not complete until this is resolved.

## Preservation Harness Requirements

The harness must exist before module extraction.

Required checks:

- render the frozen fixture through `render-existing`;
- normalize `index.html` and compare it against a stored signature or baseline;
- compare normalized `state.v2.scenarioContracts`;
- assert `state.regenerated.json` exists and has expected regenerated metadata;
- replay `run-adversarial.mjs` against the fixture or a copied fixture run;
- handle timestamp, order, run-dir, machine, and path nondeterminism explicitly;
- report ffmpeg availability and skip/fail visual cases according to a documented
  policy.

Acceptable fixture sources:

- a checked-in sanitized fixture with required text and image artifacts; or
- a deterministic fixture builder that writes the same artifact tree from small
  checked-in inputs.

The fixture cannot require a remote Mac, secrets, network, or a live Computer Use
server.

Current implementation:

```bash
node tests/e2e/computer-use/preservation-harness.mjs run
```

The fixture is a sanitized hybrid under
`tests/e2e/computer-use/fixtures/preservation/`: a normalized `state.seed.json`,
curated real screenshots required by current visual contracts, generated text
snapshots, and expected normalized JSON signatures. The harness always runs full
adversarial replay. It does not expose a skip-adversarial acceptance path.

`run-adversarial.mjs` intentionally creates and removes
`apps/native/src/components/widget/adversarial-new-visible-surface.tsx` for the
main-coverage-drift case. The preservation harness performs defensive cleanup
before and after replay so failures do not leave that fixture file in the
worktree.

## Extraction Rules

Each extraction chunk must:

- move one logical module seam at a time;
- preserve public CLI commands and artifact names;
- preserve scenario behavior unless the PR explicitly declares a schema or
  product-contract change;
- keep the current Codex app-server path as the only production driver;
- run `node --check` on touched `.mjs` files;
- run `node tests/e2e/computer-use/run-remote-cua.mjs self-test`;
- run `node tests/e2e/computer-use/preservation-harness.mjs run`;
- run adversarial replay when the changed seam can affect report, visual proof,
  state, scenario contracts, or CLI rendering.

No extraction PR should rely only on code review. It needs objective preservation
evidence in the PR description.
