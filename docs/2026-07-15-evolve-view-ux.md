# Evolve view UX: showing the work, not the machinery

**Status:** accepted 2026-07-15 (open questions resolved, see §7); implementation
plan in `2026-07-15-evolve-view-implementation-plan.md`
**Scope:** the live progress view shown while an evolution runs (`EvolveProgress`
inside `EvolveOverlayPanel`), the events that feed it, and the perception of
speed during a run.

## 1. Problem statement

The evolve view is an event timeline fed by the Rust agent loop. It has four
related problems:

1. **Meta-procedural noise.** Rows like "Processing iteration 3...",
   "Querying AI model...", "Received AI response (1523 tokens)" and the
   `iter 3` badge describe the *machinery* of the agent loop, not progress
   toward the user's goal. Per iteration the user sees three rows that carry
   no goal-relevant information.
1. **Missing substance.** The information the user actually wants — *which
   package are we searching for? what change are we trying? why did the build
   fail?* — exists in the backend but is either dropped, truncated, or hidden
   in the `raw` string behind a subtle expander.
1. **Perceived slowness.** The longest span in every iteration is the model
   call, during which nothing changes on screen except a spinner. Providers
   are called non-streaming, so there is *nothing* to show. Terminal agents
   (Claude Code etc.) solve this by streaming tokens and command output as
   they arrive; the resulting motion is most of what makes them feel fast.
1. **Everything is a string, authored in Rust.** Event copy lives in
   `EvolveEvent` constructors (`src-tauri/src/types.rs:35-258`); the frontend
   renders `summary` verbatim and even regex-parses `raw` to recover token
   counts (`evolve-progress.tsx:48-74`). The UI cannot restyle, group, or
   enrich what it can't see structurally.

## 2. How it works today (context)

- **Protocol.** One Tauri channel, `darwin:evolve:event`
  (`src-tauri/src/types.rs:272`), carrying a flat
  `EvolveEvent { raw, summary, eventType, iteration, timestampMs, telemetry?, conversationalResponse? }`
  (`src-tauri/src/shared_types/evolve.rs:82-104`). All user-facing copy is
  built at the Rust emit sites. `telemetry` rides only the terminal
  `Complete` event.
- **Loop.** `generate_evolution` (`src-tauri/src/evolve/mod.rs:743`,
  loop at `:1056`) emits per iteration: `Iteration` → `ApiRequest` →
  `ApiResponse` → one `ToolCall` per call plus a result-specific event
  (`Thinking`/`Reading`/`Editing`/`BuildPass`/`BuildFail`/`SearchPackages`/`Question`).
  Terminal `Summarizing` + `Complete` come from the lifecycle wrapper
  (`src-tauri/src/evolve/lifecycle.rs:292,325`).
- **Providers are non-streaming.** OpenAI/OpenRouter use blocking
  `chat().create` (`evolve/providers/openai.rs:146`); Ollama sets
  `stream: false` explicitly (`providers/ollama.rs:114`). The trait returns a
  whole response — there is no delta plumbing.
- **Frontend.** `viewmodel/evolution.ts:52-69` appends every event to
  `evolveEvents` (a `start` resets the array) and mirrors `raw` into the
  Console. `EvolveProgress` renders a scrolling list of rows — icon,
  `summary`, elapsed time, and an `iter n` badge — with a click-to-expand
  `<pre>` of `raw` (`evolve-progress.tsx:168-266`). The overlay mounts only
  while `isGenerating` (`evolve-overlay-panel.tsx:28`), so the "Evolution
  Complete" header state is unreachable outside Storybook.
- **What's available but never surfaced:**
  - Assistant narration between tool calls (logged at `mod.rs:1280`, stored in
    `Evolution.messages`, never emitted). Reasoning content from
    reasoning-capable models isn't even parsed (`openai.rs:264-281`).
  - The `think` tool's actual thought text — bucketed into five canned strings
    ("Planning approach...", ...), full text only in `raw`, truncated to
    200 chars (`types.rs:58-73`).
  - Tool *arguments*: the package/search query, list pattern, etc. — only in
    `raw` as `"{tool} | args: ..."` with values truncated to 50 chars
    (`mod.rs:1918`).
  - Semantic edits: `edit_nix_file` produces
    `FileEditAction::Add { path: "environment.systemPackages", values: ["ripgrep"] }`
    — the UI shows only "Editing flake.nix".
  - Build output: full stdout/stderr captured and fed to the model
    (`tools.rs:86`, truncated to 6000 chars at `mod.rs:1852`) but the
    `BuildFail` event carries a 3-line preview and the summary is the fixed
    "Build check failed, retrying...".
  - Budgets as numbers: tokens-used/budget and iteration/max exist only inside
    formatted strings.
- **Prior art in this codebase:** the *apply* phase already streams
  `darwin-rebuild` output line-by-line (`darwin:apply:data`,
  `rebuild/darwin.rs:389-414`) and runs an LLM log summarizer emitting
  throttled friendly one-liners (`darwin:apply:summary`,
  `ai/log_summarizer.rs`, 500 ms batching). The evolve loop has none of this.

## 3. Design principles

1. **Every visible row must answer "what is being done toward my goal".**
   Machinery (iterations, API round-trips) is telemetry, not narrative. It
   stays available (Console, expanders, debug) but never occupies a timeline
   row by itself.
1. **The subject of a row is the *object*, not the *procedure*.** "Searching
   packages for **spotify**" beats "Searching packages..."; "Adding
   **ripgrep** to `environment.systemPackages`" beats "Editing flake.nix".
1. **Progressive disclosure.** One glanceable narrative line per action;
   detail (full paths, diffs, build logs, raw thought) one interaction away.
   (Matches the org guideline `progressive-disclosure` in
   darkmatter/skills `ui-ux-pro-max`.)
1. **Something must visibly change during long waits.** Streamed tokens are
   the gold standard; a live elapsed timer and streamed subprocess output are
   cheap approximations. A static spinner for 10–30 s reads as "hung".
   (Guidelines `loading-states`, `motion-meaning`.)
1. **Structure over strings.** The wire format should carry typed data;
   presentation (copy, icons, grouping, localization) belongs to the
   frontend.

## 4. Proposed design

### 4.1 Target picture

A two-zone layout replacing the undifferentiated list:

```
┌──────────────────────────────────────────────────────────┐
│ Evolving your system…                        ⏹ Stop      │
│ ▰▰▰▱▱ 12.4k / 60k tokens · 45s                           │
├──────────────────────────────────────────────────────────┤
│ ✓ Understood request                                     │
│ ✓ Searched packages for "spotify" → found spotify,       │
│   spotifyd, spotify-player                               │
│ ✓ Added spotify to environment.systemPackages    [view]  │
│ ✗ Build check failed — `spotify` is not available        │
│   on aarch64-darwin                              [log]   │
│ ─────────────────────────────────────────────────────────│
│ ◍ Trying homebrew cask instead…                    18s   │
│   │ The nixpkgs build is broken on darwin, so I'll       │
│   │ install it via homebrew.casks which is already       │
│   │ used for other GUI apps in this config…   ← streams  │
└──────────────────────────────────────────────────────────┘
```

- **History zone** (top): compact, completed *actions* with their objects and
  outcomes. Failures show the reason inline (first meaningful error line),
  with the full log behind `[log]`.
- **Focus zone** (bottom, visually dominant): the current activity as a
  headline plus a live detail area — streamed model narration/thinking while
  waiting on the provider, streamed build output during `build_check`, an
  always-ticking elapsed timer. This is where the "Claude Code feel" lives.
- **Header**: goal-framed title ("Evolving your system…" or, better, an
  echo of the prompt), a real progress affordance (token meter from structured
  numbers), Stop.
- Iteration numbers, API request/response, message counts: gone from the
  timeline. They remain in the Console (`raw` mirroring is already in place)
  and in the per-row expander.

### 4.2 Staged implementation

The stages are independently shippable and each one improves the view on its
own.

#### Stage 1 — Curate and enrich, no protocol change (S)

Backend (`src-tauri/src/types.rs` emit sites, `evolve/mod.rs`):

- Put the *object* into `summary` at every emit site:
  - `tool_call`: "Searching packages for 'spotify'", "Searching docs:
    'homebrew casks'", "Listing files in modules/", "Reading flake.nix".
    The args are already parsed at the call site (`mod.rs:1304-1315`); this is
    string work, not plumbing.
  - `thinking`: first sentence of the thought (clamped ~100 chars) instead of
    the five canned category strings; full thought stays in `raw` (raise the
    200-char truncation — these are a few KB at most).
  - `editing` (from `edit_nix_file`): render the semantic action — "Adding
    ripgrep to environment.systemPackages" (`FileEditAction` is available at
    `evolve/types.rs:7-24`).
  - `build_fail`: first meaningful error line in `summary`; full captured
    output (not 3 lines) in `raw`.
- Stop emitting `Iteration`, `ApiRequest`, `ApiResponse` as timeline events —
  or keep emitting them and filter in the frontend (safer: Console and session
  transcripts keep them; the view drops them). Frontend filter is a one-line
  allowlist in `EvolveProgress`.
- Drop the `iter n` badge (`evolve-progress.tsx:221-225`).
- Suppress the generic `ToolCall` row when a specific follow-up event
  (Reading/Editing/SearchPackages/…) always follows it — otherwise every
  action appears twice ("Searching packages..." then "Found packages: …").

Cost: a day-ish. Risk: low (Storybook mocks and the e2e assertions on event
strings need updating). This alone fixes complaints (1), (2) and most of (3)'s
information half.

#### Stage 2 — Structured events (M)

Add a typed payload to `EvolveEvent` (specta already generates the TS types):

```rust
pub struct EvolveEvent {
    // existing fields kept for compatibility…
    pub detail: Option<EvolveEventDetail>,
}

pub enum EvolveEventDetail {
    Thinking { text: String },
    ToolCall { tool: String, args: serde_json::Value },
    SearchPackages { query: String, found: Vec<String> },
    Edit { file: String, action: FileEditAction },
    Build { pass: bool, attempt: usize, log_tail: String },
    Narration { text: String },
    Progress { tokens_used: u32, token_budget: u32,
               iteration: usize, max_iterations: usize },
    // …
}
```

- Frontend owns copy, icons, grouping; kills the token-count regex on `raw`
  (`evolve-progress.tsx:48-74`), the `ChoicesJson` parsing for questions
  (`:272-288`), and enables rich detail: package results as chips, edits as
  mini-diffs, build logs in a monospace scroller.
- Emit `Progress` on every `ApiResponse` (numbers already at hand,
  `mod.rs:1204`) → real token/iteration meter in the header.
- Emit `Narration` for assistant text between tool calls (available at
  `mod.rs:1268-1284`); the view can show it in the focus zone even without
  provider streaming.

Cost: a few days including specta regen, Storybook mocks, tests. This is the
architectural payoff; everything in 4.1 that isn't plain copy depends on it.

#### Stage 3 — Liveness (M, two independent parts)

**3a. Stream what's already local (cheap, do first).**

- `build_check` runs `nix build --dry-run` via a single blocking `.output()`
  (`rebuild/darwin.rs:116-120`). Switch to the line-streaming pattern the
  apply phase already uses (`run_build_step`, `darwin.rs:331-414`): emit
  `darwin:evolve:build-output` lines (throttled ~100 ms batches) into the
  focus zone's detail area. Dry-run evaluation of a large flake takes long
  enough that this materially changes perceived speed on exactly the slowest
  tool.
- Tick the focus-zone elapsed timer client-side (a 1 s interval against
  `timestampMs`) so *something* always moves. Trivial, ship with Stage 1.

**3b. Provider token streaming (the real prize).**

- Extend `AiProvider::completion` with a delta callback or an
  `mpsc::Sender<StreamDelta>` (`providers/mod.rs:29-38`); implement via
  async-openai `create_stream` and Ollama `stream: true`. The CLI provider
  stays non-streaming (graceful degradation: focus zone shows timer only).
- Backend coalesces deltas (~100–150 ms flush, mirroring
  `log_summarizer`'s batching at `log_summarizer.rs:26`) into
  `Narration`/`Thinking` detail events; the focus zone renders them
  typewriter-style. Reasoning-model thinking deltas, where the provider
  exposes them, land in the same place.
- Complications to budget for: assembling tool-call argument deltas from the
  stream, keeping the 100 ms cancellation race (`mod.rs:1116-1151`) working
  mid-stream, and token accounting (usage arrives in the final chunk).

Cost: 3a ~1 day; 3b ~3–5 days across providers. 3b is the single biggest
lever on complaint (4).

### 4.3 Small fixes to fold in

- `getTokenProgress` regex-parses `raw` — replaced by `Progress` detail
  (Stage 2); until then it silently breaks if the Rust string changes.
- `EvolveEventType::BuildCheck` is declared but never emitted
  (`shared_types/evolve.rs:123`); `searchPackages` has no icon case and falls
  through to `CircleDot` (`evolve-progress.tsx:122`).
- `search_packages` sets `summary == raw` (`types.rs:115-123`) so the row
  looks expandable-worthy but the expander adds nothing; with Stage 2 the
  query + full result list become the detail.
- The overlay unmounts the instant `isGenerating` flips
  (`evolve-overlay-panel.tsx:28`), so success is communicated only by a toast
  and the sudden appearance of the review step. Recommend a brief (~800 ms)
  completion beat — header check + "Evolution complete" — before
  transitioning, using the existing `complete` event; respect
  reduced-motion.
- Event list should use `aria-live="polite"` on the focus zone headline so
  screen readers track progress (guideline `toast-accessibility` analog).

### 4.4 User interaction: questions and checkpoints

The loop can block on the user in two ways, both flowing through the same
`Question` event + `darwin_evolve_answer` round-trip today:

- **Agent questions** (`ask_user` tool): content decisions — free-text input
  or a chooser, rendered as the violet `QuestionPrompt` card inline in the
  timeline (`evolve-progress.tsx:290-380`).
- **Safety checkpoints** (`ask_to_continue_after_limit`, `mod.rs:~630`):
  budget limits reached, with the fixed choices `"Yes, keep going"` /
  `"Stop"` (`mod.rs:555-556`).

Integration into the focus + history layout:

1. **A question is the focus zone's third mode.** The zone already has
   "working" (spinner + streamed detail) and "waiting" (timer); a pending
   question switches it to **"needs you"**: the question card *replaces* the
   streamed-detail area, the spinner stops (the agent is genuinely idle —
   the loop blocks on `wait_for_question_response`, `mod.rs:1465`), the
   accent shifts to the interaction color, the input autofocuses (already
   done today), and the elapsed timer relabels to "waiting for you" so idle
   time doesn't read as agent slowness. `aria-live="assertive"` here — this
   is the one moment the user must not miss. No placement ambiguity arises:
   a question is by definition the current activity, and only one can be
   pending at a time.
1. **Answered questions collapse into a history row** — "Asked: *Which
   Spotify variant?* → *spotify-player*" — matching how every other completed
   action collapses. This requires fixing a real fragility: today
   "answered" exists only in local component state
   (`evolve-progress.tsx:298,308`); the backend never emits anything when the
   answer arrives (it only appends `"User response: …"` to the model
   messages, `mod.rs:1494-1502`). If the card remounts, the answer record is
   lost and a stale input can reappear. **Stage 2 must add an `Answered`
   detail event** (emitted right after `wait_for_question_response` returns)
   so Q+A pairs are part of the event stream — which also makes them appear
   in the Console, session transcripts, and Storybook fixtures for free, and
   kills the `ChoicesJson` regex parsing (`evolve-progress.tsx:272-288`) via
   typed `Question { text, choices, kind }` detail.
1. **Style the two kinds differently.** Agent questions are conversational
   and goal-relevant; checkpoints are system-level interruptions. A
   checkpoint should look like a system notice — neutral styling, the
   budget meter it relates to shown in context ("Used 50k / 50k tokens —
   continue?"), and its choices as explicit continue/stop buttons — rather
   than the agent "asking a question". The kind is known at the emit site,
   so this is one enum field on the `Question` detail.
1. **Attention when unfocused.** A blocked run makes wall-clock time worse,
   not better: if the user has switched away, nothing happens until they
   return. The header spinner should switch to a "paused, input needed"
   state, and an OS-level nudge fires when the app is unfocused (decided,
   see §7; `tauri-plugin-notification` is already installed with the
   `notification:default` capability).
1. **Interplay with streaming (Stage 3b):** any narration streamed before the
   question simply collapses into history like other completed detail; the
   question takes over the focus zone. On answer, the zone flips back to
   "working" immediately (the next `ApiRequest` follows at once), so the
   transition is naturally animated by the existing flow.

## 5. Alternatives considered

### Layout

| Option | Sketch | Trade-offs |
|---|---|---|
| **A. Polished flat feed** (today's shape, better strings) | one chronological list | Cheapest; no new components. But history and "now" compete visually, long runs scroll into noise, and there is no natural home for streamed detail. Fine as the Stage-1 interim state. |
| **B. Focus + history** (recommended) | dominant current-activity zone + compact history | Matches the mental model ("what is it doing *now*?" is the question 90% of the time); gives streaming a home; history stays glanceable. Slightly more layout work; needs care so the focus zone doesn't jump when actions are fast (\<300 ms: batch, per guideline `loading-states`). |
| **C. Goal-phase checklist** (map events onto fixed phases: Understand → Explore → Change → Verify → Summarize; `MultiStepLoaderInline` exists unused for exactly this look) | stepper with nested detail | Most "product-like" and calm. But the loop is genuinely nonlinear — build-fail loops reopen "Change" after "Verify", which either lies to the user or produces a checklist that un-checks itself. Works only as a *coarse header strip* on top of B, not as the primary display. |

Recommendation: **B**, optionally with C's phase strip as a later cosmetic
layer once real-run event distributions are known.

### Where copy is authored

- *Keep in Rust* (status quo): one source of truth shared by widget, Console,
  session transcripts; but UI iteration requires Rust rebuilds, and
  copy/structure stay entangled.
- *Move to frontend via structured events* (recommended, Stage 2): fastest UI
  iteration, localization-ready, Storybook-testable. `summary`/`raw` remain on
  the wire for the Console and transcripts, so nothing downstream breaks.

### How to fill the model-wait gap

- *Token streaming* (3b): honest, information-dense, the industry-standard
  feel. Costs provider plumbing; raw model prose can be too chatty — mitigate
  by giving thinking/narration a visually quiet style (dim, small, clipped to
  ~4 lines) rather than promoting it to timeline rows.
- *LLM-generated status lines* (reuse `log_summarizer` on the loop): friendly
  one-liners without protocol changes to providers. But it adds latency, cost,
  and a second model call to explain the first; better reserved for the apply
  phase where the raw material (nix logs) is unreadable. Model narration in
  the evolve loop is already human-readable — summarizing it is redundant.
- *Purely cosmetic animation* (indeterminate shimmer, cycling verbs): zero
  information; helps for the first seconds but erodes trust on long waits.
  Use only as the sub-300 ms layer.

### Event volume control

Streaming raises event rates. Two options: throttle in Rust (coalesce deltas
before emit — recommended, one implementation for all frontends, mirrors
`log_summarizer`'s `EMIT_INTERVAL_MS`) vs. buffer in the frontend store
(flexible but every consumer must re-solve it, and the Tauri IPC cost is
already paid). Keep the existing rule that a `start` event resets state, so
runs stay self-cleaning.

## 6. Suggested order of work

1. Stage 1 (curated strings + frontend filter + timer tick) — immediate UX
   win, no protocol risk.
1. Stage 2 (structured `detail` payload + header meter + narration events) —
   unlocks everything else.
1. Stage 3a (stream `build_check` output).
1. Layout B (focus + history zones), completion beat, a11y.
1. Stage 3b (provider streaming) — largest single effort, largest perceived
   payoff.

## 7. Resolved questions

- Should a pending question nudge the user when the app is unfocused
  (notification, dock bounce, mascot reaction)? Requires deciding on
  notification permissions/settings.
  ANSWER: nudge + notification if app not in focus.

- Should intermediate assistant narration be visible by default or
  collapsed? Proposal: visible in the focus zone while current, collapsed
  into the action row once superseded.
  ANSWER: accept proposal.

- Do we cap history rows for very long runs (`ManyIterations` story:
  80 events) or group by build-attempt? Grouping by attempt is more meaningful
  than by iteration.
  ANSWER: by attempt.

- The CLI provider (shelling out to a `claude`/`codex`/`opencode` binary,
  `ai/providers/cli.rs:11-15`) can never stream: the response arrives whole
  when the subprocess exits, and its stdout is the parsed payload, not prose.
  Users on that backend fall back to headline + timer only. Is that
  acceptable, or does it warrant a filler treatment (e.g. keeping the
  previous iteration's thinking text visible, dimmed, in the detail area)?
  Inclination: accept timer-only; it is a developer-oriented path.
  ANSWER: cheapest option, CLI providers are not important.
