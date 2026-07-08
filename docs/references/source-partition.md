# Source Partition

Status: active. Use this file before creating harness evaluation or offline
replay tasks.

This file is evaluation hygiene, not people-scoring. It records which source
material has already influenced the harness so future tests do not accidentally
grade agents on material they were given in the prompt or docs.

## Partition Rules

- `training`: source content has been read, summarized, quoted, or distilled
  into source-corpus artifacts. It can inform harness docs.
- `calibration`: source content may tune judge rubrics, scoring thresholds, and
  prompt/schema checks, but it must not be counted as final held-out scoring.
- `held-out`: source content is reserved for final scoring and must not train
  harness docs, prompts, examples, or task-specific guidance.
- `inventory-only`: source metadata was seen for discovery, but detailed source
  content was not parsed. It is not clean held-out yet. Before use, certify that
  no source details were included in training artifacts and construct prompts
  without leaking title, review, or meeting wording.
- `excluded`: source is disqualified because it appears in current docs, memory,
  prior offline-evaluation artifacts, user-provided constraints, or this
  partition's exclusion list.

## Training Sources

- Slack `#nixmac` full channel sweep from 2026-07-02 11:55:33 PDT back to
  channel creation at 2026-01-12 23:40:17 PST, including 17 channel pages and
  244 expanded/classified thread parents.
- Granola full transcripts already summarized into the corpus:
  `664569f3-8856-4318-a96d-d908a698f470`,
  `380b9f1c-af70-4bfa-b7fd-78883d026cb4`,
  `8cef4c1c-4d18-422f-9eb6-878838e0ddf2`,
  `662926c5-aeaa-4c61-ae92-edee80d907cc`,
  `643a719e-a2da-4416-80b7-847d15109d91`,
  `85d1096c-60d7-4928-be09-1100ce0cb196`,
  `59dd0b8c-b804-42ab-a005-2127d442f325`,
  `3614c8be-2c93-455c-ad0e-0c24d4626a30`, and
  `f69b7a9a-d313-4703-af66-1744f54943d3`.
- Granola summaries already summarized into the corpus:
  `f37f7bcc-da2f-45a2-add4-3ff04701c411`,
  `3614c8be-2c93-455c-ad0e-0c24d4626a30`,
  `91284ce1-3994-49b0-b43b-2f924bfaa585`, and the Cooper weekly summary for
  `f69b7a9a-d313-4703-af66-1744f54943d3`.
- GitHub detailed PR/review evidence already parsed: #409, #411, #419, #420,
  #437, #438, #439, #442, #445, #447, #449, #450, #452, #453, #461. PR #411
  has a complete paginated file list captured in the Phase 1 source package;
  any first-page-only file list is capped at 100 files and must not be used
  alone.
- Code sampled to understand maintainer-style repo patterns:
  `apps/native/src/lib/orpc.ts`, `apps/native/src/ipc/api.ts`,
  `apps/native/src/lib/errors.ts`,
  `apps/native/src/components/widget/onboarding/use-onboarding-flow.ts`,
  `apps/native/src-tauri/src/managed_edits/managed_edit.rs`,
  `apps/native/src-tauri/src/managed_edits/homebrew_adopt.rs`,
  `apps/native/src-tauri/src/state/evolve_state.rs`,
  `apps/native/src-tauri/src/git/query.rs`,
  `ARCHITECTURE.md`, and supporting code-history metadata for
  maintainer-pattern summaries.

## Calibration Candidates

Use calibration sources only for rubric tuning or sanity-checking harness
changes, not final held-out scoring. Keep the concrete calibration inventory in
local run artifacts, not in durable agent docs that may be bundled into future
evaluation arms.

Calibration sources are adjacent to training themes, and many titles or
metadata were seen during discovery. They can tune whether the rubric is
sensitive to known categories, but they are not blind held-out evidence.

## Inventory-Only Held-Out Candidates

These are possible held-out sources only if a later certification pass confirms
they were not summarized into harness docs and that prompts omit leaked
metadata:

- PRs after the detailed set that were only seen as metadata in the merged-PR
  inventory, excluding the training and calibration PRs above.
- Future merged PRs after the Phase 1 source freeze.
- Granola meetings listed but not opened or summarized.
- GitHub PR review threads not fetched in the Phase 1 PR evidence package.

Certification requirements before promoting any inventory source to held-out:

- Verify the source body, diffs, comments, review threads, and transcript were
  not read earlier in this loop.
- Verify the source is not represented in the Phase 1 source-corpus report,
  author-patterns report, review-taxonomy report, existing `docs/`, Codex
  memory, or prior offline-evaluation artifacts.
- Reject the candidate if the PR title, branch, files, body, comments, review
  threads, meeting title, transcript, or prompt includes beads or `.beads`.
- Create the task prompt from the product/code situation, not from review-comment
  wording or source title.
- Record PR/meeting/source id, certifier, timestamp, and exact artifacts checked.

## Excluded Sources

These exclusions apply to evaluation/offline-replay scoring, not to historical
training attribution.

- First-loop excluded PRs from the proposal: #406, #420, #442, #445, #450,
  #453, #461.
- PRs already explicitly discussed in prior harness evaluation memory: #406,
  #420, #442, #445, #450, #453, #461.
- Beads sources and `.beads/` history per user instruction to ignore beads.
- Any Slack/Granola source already distilled into the Phase 1 corpus.
- Any PR or code sample directly named in final harness docs before scoring.

## Current Held-Out Status

No source is certified as held-out yet. This is intentional: the source mining
has been broad enough that premature held-out claims would risk leakage. The
next phase must either certify inventory-only sources or wait for new merged PRs
after the source freeze.
