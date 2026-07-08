# Release and CI Domain

Release and CI policy is in transition. Document current reality before changing
workflows.

## Current Reality

- Contributors currently target `main`.
- Graphite merge queue is present on stacked PRs.
- Squash merges are enforced. Large branches should be split into reviewable
  stacked PRs instead of relying on commit history to carry review context.
- Farhan clarified on 2026-07-07 that the team no longer uses `develop` as
  trunk; local git also reports `origin/HEAD` as `origin/main`. Treat
  `origin/develop` as legacy unless a current task explicitly says otherwise.
- Slack `#nixmac` on 2026-07-02 aligned release mechanics around `main` plus
  tags: `main` is the active integration branch, tags/releases carry release
  identity, and notarization/build proof should not be coupled to publishing a
  tagged release unless a release task explicitly says so.
- As of the 2026-07-07 trunk correction, `origin/develop` still held one
  non-patch-equivalent commit not on `origin/main`: `c8ad0219b` / PR #394,
  "Fix feedback dialog focus ring clipping." Re-land it on `main` or confirm it
  was superseded before deleting or ignoring `develop` entirely.
- ENG-454 is historical decision context for release/update policy. Do not
  infer current trunk from it.
- Existing PR template and Danger checks expect docs/test-plan hygiene.
- nixmac had public launch traffic by 2026-07-06. Treat release, update,
  signing, and artifact-verification changes as user-impacting production work,
  not pre-beta housekeeping.

## Known Reliability Issues

- CI-built app artifacts may fail signing/notarization checks and may not open
  after download from GitHub Actions.
- Vitest/Playwright can launch the wrong Chromium revision in the Nix dev shell.
- CI runner disk pressure has blocked PRs in the past.
- Storybook snapshot failures may be real failures or stale snapshots; review
  the diff and context before dismissing them.
- Product Proof / Computer Use E2E exists but is stale/advisory.
- Product Proof's durable contract lives in [product-proof.md](product-proof.md)
  and `tests/e2e/computer-use/`.
- Setup phases should stay attributable. Avoid hiding Nix, devenv, Xcode, Bun,
  Rust, signing, and notarization setup behind one opaque step when separate
  phases would make failures easier to triage.
- PR or trunk build verification may include signing/notarization checks without
  creating release tags. Keep "prove this artifact opens and verifies" distinct
  from "publish a release/update channel artifact."
- Auto-update behavior is part of the branch/release transition. Verify update
  channel behavior separately from branch-base cleanup and tagging changes.

## Prod Safety

Do not dispatch workflows, trigger releases, run deployment jobs, rotate secrets,
or operate remote production systems as part of docs or normal code review work
unless explicitly asked.

## Verification

For release or CI changes, verify affected workflow triggers, branch filters,
secret usage, artifact paths, and local command equivalents. Signing/notarization
fixes require actual artifact verification with `codesign`/`spctl` on macOS.
