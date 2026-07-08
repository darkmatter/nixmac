# Source Log

This file records durable evidence used to create or update these docs. Keep it
short and source-oriented.

## 2026-07-01 Harness Docs Pass

Repo evidence:

- `.github/copilot-instructions.md` was stale for state/IPC. It still described
  Zustand and legacy `invoke()` as defaults.
- `.cursor/rules/native-orpc.mdc` requires oRPC plus TanStack Query for new IPC.
- `.cursor/rules/native-state-package.mdc` keeps shared state/projections in
  `packages/state` while pointing Rust async data at oRPC/React Query.
- `.cursor/rules/native-config-tiers.mdc` defines build profile, user preference,
  and project setting tiers.
- `Cargo.toml`, Rust sources, and `apps/native/src-tauri/prompts/system.md`
  preserve additional still-current conventions: unused Rust items are denied,
  serde boundary types use camelCase, environment-mutating tests use
  `e2e_env_lock`, and the in-app agent has a strict tool contract.
- `dangerfile.ts` already checks Linear IDs, test plans, Storybook stories, new
  Rust module tests, new TS tests, lockfile drift, infra/secrets changes, and
  docs drift.
- `tests/e2e/computer-use/` describes Product Proof but Farhan stated it is
  currently out of date.

Slack `#nixmac` evidence:

- `1782868161.944739`: Cooper's June 30 onboarding P1 list; full thread read.
- `1782522759.331799`: secrets/profile setup, dev/prod confusion, treefmt drift,
  and secret-looking values; full thread read.
- `1781469192.361809`: Cooper's concern that agents are struggling with
  non-standard local patterns; no replies.
- `1781254726.273589`: login items and services discussion; full thread read.
- `1781122680.685399`: git/DB drift causing review page confusion; full thread
  read.
- `1782069018.389269`: new onboarding Storybook thread, auth outage, app-local
  settings drift, and empty-diff save bug; full thread read.
- `1782792134.119519`: Vitest/Playwright revision mismatch; full thread read.
- `1782113377.930029`: auto-nixfmt scope and invasiveness; full thread read.

Granola meeting evidence:

- `nixmac sync jun 30` (`664569f3-8856-4318-a96d-d908a698f470`):
  onboarding removal/config-directory decisions, app-management permission,
  SQLite lock, Fix with AI, and template registry notes.
- `Farhan / Cooper (Weekly)` (`f69b7a9a-d313-4703-af66-1744f54943d3`):
  Storybook as AI coding harness, agent-code quality, linter/sub-agent
  guidance, and harness-over-model framing.
- `Track changes feature` (`380b9f1c-af70-4bfa-b7fd-78883d026cb4`):
  file-view tab, feature flag tiers, token budgets, eval timeout, and zero-touch
  onboarding ambitions.
- `nixmac weekly sync` (`8cef4c1c-4d18-422f-9eb6-878838e0ddf2`):
  Diesel/Git2 migrations, options search, Product Proof HTML report, and
  multi-config eval direction.

GitHub/Linear evidence:

- Linear project `nixmac`: milestone 1 target is fresh Mac "zero to wow in under
  8 minutes"; milestone 2 targets closed-beta readiness.
- ENG-582 / GitHub #448: onboarding password prompt spam and flow disappearance.
- ENG-586 to ENG-589: recent P1 onboarding issues from Slack.
- GitHub #444: CI-built artifacts signing/notarization issue.
- GitHub #454: Vitest/Playwright browser revision mismatch.
- GitHub #455: dev environment missing secrets and local env defaulting prod.
- PR #420, #445, #450, #453, #461 review threads were inspected for resolved,
  outdated, and current feedback patterns.

Historical repo docs:

- `docs/2026-05-29-state-management-migration-plan.md`,
  `docs/2026-06-03-pr-review-followups.md`,
  `docs/2026-06-12-changeset-reconciliation.md`, and
  `docs/2026-06-12-viewmodel-completion-plan.md` were reclassified through
  `docs/exec-plans/completed/historical-index.md`.

## 2026-07-07 Trunk Correction

- Farhan direct instruction: nixmac no longer uses `develop` as trunk; current
  agent and PR base guidance should point to `main`.
- Local git evidence: `origin/HEAD` resolves to `refs/remotes/origin/main`.
- Local git evidence: `origin/develop` still contains one commit not on
  `origin/main`, `c8ad0219b` / PR #394, "Fix feedback dialog focus ring
  clipping"; treat that as reconciliation debt, not current base-branch
  guidance.
- ENG-454 remains historical trunk/release/update policy context; do not treat
  it as current base-branch guidance.

## 2026-07-08 Slack Docs/ADR Gap Audit

Slack `#nixmac` evidence promoted into ADR/domain docs:

- `1783003978.001709`, `1783004626.260199`, `1783017561.729929`: `main` is
  current trunk; tags/release artifacts carry release identity; notarization and
  build proof should stay separable from release publishing.
- `1783224838.315369`, `1783223555.180529`, `1783406846.980099`: runtime
  nix-darwin/Home Manager option metadata, scanner behavior, and `search_docs`
  should share provenance; cache invalidation should account for pinned inputs
  such as `flake.lock`; legacy bundled `*-options.json` and atomic markdown
  files should not be treated as the product contract unless shipped code reads
  them.
- `1783221010.434369` through `1783222894.262459`: feedback submission route,
  Sentry DSN, feedback DSN, and device API-key auth are separate contracts; the
  web route reviewed in that thread did not prove device-key auth was shipped.
- `1783070556.194249`, `1783232564.365029`: onboarding import needs idempotent
  retry/back behavior, staged materialization, single-flake auto-selection only
  when unambiguous, and custom-template flow separated from importing an
  existing repo.
- `1783338029.942799`: Cursor automation report called out privileged shell
  interpolation, ambiguous GitHub URL parsing before auth/materialization, and
  empty or ambiguous CLI model defaults as security/reliability risks.
- `1782972658.034909` plus `apps/native/src/lib/orpc.ts`: oRPC/TanStack source
  docs already encode much of the durable IPC/query pattern; harness docs should
  point agents to that source instead of duplicating every hook detail.
- `1783412207.128769`: squash merges are enforced; agents should split large
  branches into reviewable stacked PRs instead of depending on commit history
  for review context.
- `1783329489.676799`, `1783329565.975919`: nixmac had public Product Hunt
  launch traffic by 2026-07-06, so release/update/signing changes should be
  treated as production-user-impacting.
- `1783178222.027619`: auto-update and release logic still needed explicit
  verification after the transition away from `develop`.

## 2026-07-02 Phase 1 Source Mining Promotion

Phase 1 run artifacts (local, gitignored provenance; summarize the findings
inline for fresh clones):

- `.agent-runs/2026-07-02-harness-loop/phase1/source-corpus-report.md`
- `.agent-runs/2026-07-02-harness-loop/phase1/source-corpus-manifest.json`
- `.agent-runs/2026-07-02-harness-loop/phase1/processed/author-patterns.md`
- `.agent-runs/2026-07-02-harness-loop/phase1/processed/github-review-taxonomy.md`
- [source-partition.md](source-partition.md) promotes the evaluation partition
  from the Phase 1 scratch package into durable docs.

Coverage:

- Slack `#nixmac`: 17 channel pages to channel creation, with 244
  expanded/classified thread parents. Beads thread `1778553916.633639` excluded.
- Granola transcripts: Jun 30 nixmac sync, Jun 23 Farhan/Cooper weekly, Jun 11
  track changes, Jun 4 weekly sync, May 28 sync, May 20 Farhan/Juan testing
  overview, May 14 sync, Apr 9 wave 0, Mar 17 sync, and Jun 2 marketing /
  spot-instance / OpenCode setup.
- Granola summaries: May 15 backlog/launch blockers and May 12 NixOS tool /
  reliability / config import.
- GitHub detailed PR evidence: #409, #411, #419, #420, #437, #438, #439, #442,
  #445, #447, #449, #450, #452, #453, #461. PR #411 file list was paginated to
  168/168 files.

Promoted Slack decisions:

- `1777008751.166809`, `1777020422.280879`: no single test lane covers all bug
  reports; choose unit, mocked Playwright, WebDriver, or Computer Use based on
  behavior.
- `1777360808.052979`: precise non-AI edit-review-save flows are first-class
  product flows for known domains.
- `1777447420.091389`, `1777452460.213139`, `1778121305.030829`: token budgets
  need tokenizer-aware handling; long lines and unbounded reason fields break
  summary/evolve paths.
- `1777889254.580789`: WDIO tests start the nixmac binary; do not assume nested
  process-compose startup.
- `1778002652.288639`, `1778553147.953279`, `1781753847.685769`: provider
  availability/model-alias claims need timestamped verification.
- `1778483597.890719`, `1779099733.898479`: merge queue and check-state issues
  should be classified separately from code failures.
- `1780623963.419429`: SQLite pooling needs justification in a local single-user
  app; serialized writes are often more important.
- `1781243060.627749`, `1780993746.438029`: prompt-seeded defaults were a
  bridge; deterministic managed edits are preferred for known structured data.

Promoted Granola decisions:

- May 20 Farhan/Juan transcript: the test stack has Rust, TypeScript, Storybook,
  AI eval, and Computer Use layers; evals need varied starting configs; large
  vibe-coded app-code PRs need smaller reviewable slices.
- Jun 23 Farhan/Cooper transcript: Storybook can constrain agents for UI work;
  deterministic lints/checks and scoped sub-agents matter more than raw model
  choice; CLI-first/core-logic-first implementation can improve code quality.
- May 15 Juan backlog summary: launch blockers included evolve speed,
  individual customization selection, Nix formatting preservation, and
  notification recovery; direct Anthropic/OpenAI support mattered for launch.
- May 12 NixOS tool summary: evolution reliability comes before plugin
  expansion; config import is a major product wedge.

Review gates:

- Initial Phase 1 source-package review: 3 blockers; accepted fixes applied.
- First follow-up source-package review: 1 blocker; accepted fixes applied.
- Second follow-up source-package review: zero blockers; nonblocking accepted
  fixes applied.
