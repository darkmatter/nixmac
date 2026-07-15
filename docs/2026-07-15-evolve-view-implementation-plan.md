# Evolve view redesign — implementation plan

**Design:** `2026-07-15-evolve-view-ux.md` (accepted, decisions in its §7).
**Shape:** seven PRs. PR 1 and PR 2 are independent quick wins; PR 3 is the
protocol change everything later builds on; PR 7 (provider streaming) is the
largest and lands last.

## Ground rules (apply to every PR)

- `summary` and `raw` stay populated on every event throughout: the Console
  mirror (`viewmodel/evolution.ts:63`), session transcripts
  (`session_log::append_event`), and any eval tooling keep working unchanged.
  New structure is additive.
- Preserve the `question-prompt-input` / `question-prompt-submit` test ids —
  they are the only evolve-view selectors the wdio e2e suite depends on
  (`e2e-tauri/tests/wdio/helpers/app-ui.ts:85-92`).
- After touching `shared_types`, regenerate TS bindings with the specta
  example — it must run from `apps/native/src-tauri` (cwd-sensitive), inside
  the devenv shell.
- Each PR updates the affected Storybook stories/mocks
  (`evolve-progress.stories.tsx`, `evolve-flow.stories.tsx`,
  `.storybook/mocks/tauri-runtime.ts`) in the same PR, and lands as a series
  of individually green commits.
- Verification per PR: `cargo test` (devenv shell), frontend unit tests,
  Storybook snapshots, the evolve wdio specs (`basic-prompts`,
  `conversational`, `modify`), plus one manual run of a real evolution.

## PR 1 — Object-first event copy (backend only) — S

Rewrite the `EvolveEvent` constructors (`src-tauri/src/types.rs:35-258`) and
their call sites in `evolve/mod.rs` so every summary names its object:

- `tool_call` (`types.rs:125`): take the parsed args (available at
  `mod.rs:1304-1315`) and build "Searching packages for 'spotify'",
  "Searching docs: 'homebrew casks'", "Listing files in modules/",
  "Searching code for 'homebrew'". Raise the 50-char per-value truncation in
  `summarize_args` (`mod.rs:1918`) where it feeds summaries.
- `thinking` (`types.rs:58`): summary = first sentence of the thought,
  clamped ~100 chars, falling back to the category strings only for empty
  thoughts; raise the `raw` truncation from 200 to ~2000 chars.
- `editing` (`types.rs:85`): accept an optional semantic action
  (`FileEditAction`, `evolve/types.rs:7-24`) and render "Adding ripgrep to
  environment.systemPackages"; plain `edit_file` keeps "Editing {file}".
- `build_fail` (`types.rs:105`): summary = first meaningful error line
  (reuse/extract the preview heuristic at `mod.rs:1401`); `raw` = the full
  captured output the model sees (the 6000-char truncated form from
  `mod.rs:1852`), not 3 lines.
- `search_packages` (`types.rs:115`): include the query — "Searched packages
  for 'spotify' → spotify, spotifyd, spotify-player"; full result listing in
  `raw`.

Deliverable: the existing UI immediately reads object-first with zero
frontend changes. Unit tests on the constructors' string output.

## PR 2 — Frontend curation + liveness tick — S

`evolve-progress.tsx` only:

- Add a hidden-types set — `iteration`, `apiRequest`, `apiResponse`,
  `toolCall` — filtered out of the timeline render (events still reach the
  store and Console). `toolCall` is hidden because a specific follow-up event
  always narrates the same action.
- Remove the `iter n` badge (`:221-225`).
- Live elapsed ticker: a 1 s interval re-rendering the latest row's time and
  the header. Compute from a locally captured `receivedAt` for the last
  event, not `timestampMs` (which is fixed at emit time).
- Small fixes: `searchPackages` icon case (currently falls through to
  `CircleDot`, `:122`); drop the unused `buildCheck` icon/color branches or
  leave with a comment that the variant is never emitted.
- Update `evolve-progress.stories.tsx` args so hidden types demonstrate the
  filtering, and refresh snapshots.

## PR 3 — Structured `detail` payload — M

The protocol change (design §4.2 Stage 2):

- `shared_types/evolve.rs`: add `detail: Option<EvolveEventDetail>` to
  `EvolveEvent` plus the enum:
  `Thinking { text }`, `ToolCall { tool, args }`,
  `SearchPackages { query, found }`, `Edit { file, action }`,
  `Build { pass, attempt, log_tail }`, `Narration { text }`,
  `Progress { tokens_used, token_budget, iteration, max_iterations }`,
  `Question { text, choices, kind }`, `Answered { text }`.
  Serde-default/optional so old transcripts deserialize.
- Emit `detail` at every existing site; emit `Progress` alongside every
  `api_response` (numbers in scope at `mod.rs:1204`) and include
  `max_iterations` from prefs.
- Emit `Narration` for non-empty assistant text between tool calls
  (`mod.rs:1268-1284`).
- Regenerate specta TS; update `ipc/types.ts` consumers.
- Frontend: rendering prefers `detail` (copy/icons/grouping computed in TS),
  falls back to `summary`. Delete the token regex (`getTokenProgress`,
  `evolve-progress.tsx:48-74`) and drive a header token/iteration meter from
  `Progress` (use the `progress.tsx` UI component).
- Update Storybook mocks to carry `detail`.

## PR 4 — Question/answer round-trip + checkpoints + nudge — M

- Backend: `Question.kind` distinguishes `agent` (`ask_user`) from
  `checkpoint` (`ask_to_continue_after_limit`, `mod.rs:~630`). Emit an
  `Answered` event right after `wait_for_question_response` returns
  (`mod.rs:1494`), and equivalently for limit prompts, including the
  non-interactive default-stop path (`mod.rs:656`).
- Frontend: `QuestionPrompt` reads typed `detail` (delete
  `parseQuestionChoices`, `evolve-progress.tsx:272-288`); "answered" state
  derives from the presence of an `Answered` event instead of local
  `useState` (`:298,308`), so remounts can't resurrect a stale input.
  Answered pairs render as a compact "Asked … → …" row.
- Checkpoint styling: system-notice variant showing the relevant budget
  ("Used 50k / 50k tokens — continue?") with explicit continue/stop buttons.
- Nudge (design §7 decision): when a `question` event arrives and the window
  is unfocused, fire an OS notification via `tauri-plugin-notification`
  (already a dependency with the `notification:default` capability) and
  request attention on the app. No new settings surface for now.

## PR 5 — Focus + history layout — M

Depends on PR 3 (and PR 4 for the question mode).

- Split `EvolveProgress` into `HistoryZone` and `FocusZone` (design §4.1).
  Focus zone modes: *working* (headline + detail area + timer), *waiting*
  (timer only — the CLI-provider experience, accepted as-is per §7),
  *needs-you* (question card; timer relabels "waiting for you";
  `aria-live="assertive"`; spinner stops).
- Narration behavior per §7 decision: visible in the focus zone while
  current; collapsed into its action row once superseded.
- History grouping **by build attempt** (§7 decision): backend already
  stamps `Build.attempt` (PR 3); group rows between build boundaries,
  auto-collapse all but the current attempt, "attempt N — failed: {reason}"
  as group headers.
- Completion beat: `EvolveOverlayPanel` lingers ~800 ms after the `complete`
  event (green check header) before unmounting; skip under
  `prefers-reduced-motion`.
- `aria-live="polite"` on the focus-zone headline.
- New Storybook stories per zone/mode; rework `ManyIterations` to demonstrate
  attempt grouping.

## PR 6 — Stream build_check output — S/M

- Add a streaming variant of `dry_run_build_check`
  (`rebuild/darwin.rs:83-126`) modeled on `run_build_step`
  (`darwin.rs:331-414`): spawn with piped stdout/stderr, read line-by-line,
  batch ~100–150 ms, emit as `Build`-scoped output-chunk events (either a
  `BuildOutput { chunk }` detail or a dedicated channel — prefer the detail
  event so transcripts capture it). Ensure cancellation kills the child.
- Frontend: focus-zone log area during `build_check` — monospace, tail-follow,
  ring buffer capped (~500 lines).

## PR 7 — Provider token streaming — L

Behind a developer flag first (`settings/overridable-flags.ts`), promoted to
default once stable.

- `providers/mod.rs`: extend the trait with a streaming entry point (delta
  channel/callback); default implementation delegates to the blocking call so
  `CliProvider` is untouched (§7: no filler treatment).
- `openai.rs`: `create_stream` with `stream_options.include_usage` for token
  accounting from the final chunk; assemble tool-call argument deltas.
  `ollama.rs`: `stream: true` NDJSON.
- `mod.rs`: keep the 100 ms cancellation race working mid-stream
  (`mod.rs:1116-1151`); coalesce text deltas at ~100–150 ms into
  `Narration`/`Thinking` detail updates (mirror `log_summarizer`'s batching
  approach, `ai/log_summarizer.rs:26`).
- Frontend: typewriter-style incremental rendering in the focus zone;
  clip to ~4 visible lines, quiet styling.

## Dependency graph

```
PR1 ──┐
PR2 ──┼── independent, land first in any order
      │
PR3 ──┬── PR4 ──┐
      ├── PR6   ├── PR5 (layout; wants PR4's question mode)
      └── PR7   │
```

Suggested landing order: 1, 2, 3, 4, 5, 6, 7 — each leaves the app strictly
better than the previous state.
