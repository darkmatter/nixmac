# Computer Use E2E V2 Proposal

## Scope Boundary

V2 stays inside this PR's Computer Use E2E/reporting feature. It must not change
nixmac product code, Tauri commands, provider behavior, app UI, or app
accessibility labels. Product gaps found by V2 become report evidence,
follow-up tickets, or future app PRs.

## Goal

V1 proves that Codex Computer Use can run the real remote macOS app, publish an
HTML report, and keep the PR check non-blocking. V2 makes that product harder to
misread by separating three concepts that V1 partially merged:

- deterministic pass/fail verdict;
- evidence strength behind each scenario;
- failure/risk classification when a scenario is weak, inconclusive, or failed.

The deterministic runner remains the source of truth. Model critics, if added
later, are advisory only and cannot flip pass/fail.

## Canonical Scenario Contract

Do not add a fifth drifting scenario catalog. For this PR, V2 is derived from the
runner-owned V1 structures:

- `scenarioLabels`
- `scenarioGroups`
- `scenarioProofCatalog`
- `EVOLVED_CASE_CATALOG`
- `coverage-manifest.json`

The immediate implementation writes a derived `state.v2.scenarioContracts`
object in `state.json`/`state.regenerated.json`. A later cleanup PR can move
those V1 structures into one canonical scenario-registry module, but the runner
and report must consume one canonical source at a time.

Each V2 scenario contract exposes:

- scenario id and label;
- deterministic status;
- legacy V1 evidence grade;
- V2 evidence strength;
- assertion types;
- accessibility assertion risk;
- runtime failure class for non-pass outcomes;
- proof and limitation text.

## Evidence Strength

V2 keeps V1 grades visible but maps them to a reviewer-facing strength model:

| V1 grade | V2 strength |
| --- | --- |
| `action-confirmed` | `operational` |
| `text-confirmed` | `visual-supported`, downgraded to `weak` when screenshots are intentionally absent |
| `guardrail-confirmed` | `operational` |
| `manifest-confirmed` | `operational` |
| `calibration` | `weak` |
| `not-run` | `not-proved` |

`saveFlow` and `rollbackCleanup` can become `strong` because they combine
Computer Use UI evidence with independent disposable git-state proof.

## Accessibility Dependency Audit

The report should explicitly show scenarios where accessibility text is the main
semantic assertion source. This does not make the suite unreliable by itself;
it tells reviewers which green checks depend on the app's accessibility tree and
which checks have independent state or manifest proof.

Sensitive surfaces such as API Keys and Console intentionally omit screenshots.
Those passes should be visibly weaker than Save/Rollback passes, even when the
deterministic scenario verdict is green.

## Targeted Visual Heuristics

V1 already checks that referenced artifacts exist, are non-empty, are not blank,
and do not leak sensitive screenshots. V2 adds narrower report-quality checks:

- overlay annotation geometry must remain inside image bounds;
- proof cards should show evidence strength and failure class near the claim;
- visual checks should downgrade or fail evidence quality, not pretend to be
  pixel-perfect visual regression.

This is not screenshot golden testing.

## Failure Taxonomy

Failure class is a runtime classification on the scenario result, not a static
property of the scenario. A single scenario can fail because of the app,
provider, credential, DXU infrastructure, harness, or coverage drift depending
on the run.

The V2 taxonomy is:

- `app`
- `provider`
- `credential`
- `remote_infra`
- `harness`
- `coverage`
- `inconclusive`

The report renders non-pass classifications near the deterministic verdict so a
provider outage does not look like an app regression, and a DXU launchd failure
does not look like an OpenRouter failure.

## Optional Edge Lanes

Provider and external-config edge lanes stay optional. They should not become
default PR checks until they have strict setup and cleanup contracts.

Invalid/missing OpenRouter key lanes must:

- use per-run inline environment or a generated known-bad key;
- never persist the bad key into app support, keychain, or long-lived launchd;
- clear launchd environment on cleanup;
- verify cleanup before the next DXU run starts;
- share the singleton DXU concurrency group.

External config mutation lanes must:

- use only the proven disposable config;
- record baseline git HEAD before mutation;
- define an explicit assertion or label the lane observation-only;
- clean up with `git reset --hard <baseline>` plus `git clean -fd`;
- never push implicit product behavior changes through the test suite.

## Model Critics

Model critics are useful in V2 only as advisory reviewers of already-generated
evidence. They should be offline/manual or opt-in until these are solved:

- data egress and redaction for screenshots/text/remote metadata;
- cost ceiling;
- deterministic placement in the report;
- no authority over pass/fail.

If added, advisory output belongs below deterministic results or in a collapsed
section/artifact.

## Acceptance Criteria

Already met by V1:

- real remote Mac Computer Use lane;
- one-page HTML report;
- screenshot/text artifacts;
- artifact existence/nonblank/sensitive-surface checks;
- Step 3 save plus rollback cleanup;
- PR-hosted report URL.

Required for V2 in this PR:

- derived V2 scenario contracts in `state.json` and regenerated state;
- report sections for evidence model, accessibility risk, and failure taxonomy;
- scenario tables show both V1 grade and V2 strength;
- adversarial validation covers V2 evidence strength, taxonomy, accessibility
  risk, and overlay geometry;
- no core app files modified.

Future implementation PRs may add a consolidated registry module, optional
provider-edge workflows, external-config mutation lanes, and model critic
artifacts.
