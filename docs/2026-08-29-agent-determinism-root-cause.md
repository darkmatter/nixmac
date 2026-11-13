# Agent determinism defects: root-cause archaeology

Date: 2026-08-29

This is a provenance and process analysis of the eight defects found in the
`evolve` agent loop. The unit of analysis is the mechanism that entered the
product, not the person who authored a commit. Dates below are author dates;
all abbreviated SHAs resolve to commits in this repository.

## Provenance

| Defect | Introducing commit (SHA, date, subject) | Guard commit (SHA, date, subject) | Ordering verdict | Tests at the time |
| --- | --- | --- | --- | --- |
| 1. Plain assistant text after edits sets `Generated` without consulting the build gate | `b488f9e3`, 2026-03-23, **feat: implement conversational response handling and UI integration, add system guardrails (#165)** | `0d88cf87`, 2025-12-20, **evolve ux** (the original `build_verified`/`done` gate); later remediation is `ba1e601d`, 2026-07-22, **fix(evolve): gate the no-tool terminal path on build verification (N4)** | **Guard before path.** The no-tool conversational feature was added after the original gate and introduced a second terminal exit that never called it. `ba1e601d` is a later repair on `origin/jp/evolve-phase0-hardening`, not an ancestor of current `HEAD`. | `b488f9e3` adds no evolve regression test. `ba1e601d` adds the exact case-67 regression (edit, plain response, zero builds) and a verified-edit control. |
| 2. `build_verified` is cleared for failed `BuildResult` and edits, but not for the `Err` path | `0d88cf87`, 2025-12-20, **evolve ux** (introduced the latch and the `done` check) | `92786de3`, 2026-06-08, **fix(evolve): four correctness fixes in the evolve loop (#336)** (partial reset fix); the remaining error path has no later guard commit found | **Hole in the original gate, then reproduction-scoped repair.** The latch and its completion check entered together. `92786de3` clears on edits and `BuildResult { success: false }`, but does not clear when tool execution returns `Err`; no evidence found of a follow-up covering that branch. | `92786de3` adds tests for pass→failed-build and pass→edit, and its comment explicitly names both. There is no corresponding test for pass→tool-error→`done`; the introducing commit has no such test. |
| 3. `edit_nix_file` promises syntax validation although semantic writes can be accepted without it | `ff0a3be9`, 2026-03-26, **feat: edit_nix_file tool to make certain classes of edits more reliable (#175)** | `286a2848`, 2026-04-14, **feat(validation): add syntax validation for .nix and .yaml files (#6)** | **Guard after path.** The semantic editor existed first. The later validation commit wired validation into generic `edit_file` writes, not `apply_semantic_edit`; the tool description consequently became a promise stronger than the implementation. | `ff0a3be9` contains many semantic-editor unit tests, but no post-write syntax-validation test for the tool. `286a2848` tests the custom validator and generic file-edit branches, not semantic writes. |
| 4. `edit_file` validates all three write branches while the semantic branch validates none | `ff0a3be9`, 2026-03-26, **feat: edit_nix_file tool to make certain classes of edits more reliable (#175)** (semantic branch); `286a2848`, 2026-04-14, **feat(validation): add syntax validation for .nix and .yaml files (#6)** (three generic branches) | `286a2848`, 2026-04-14, **feat(validation): add syntax validation for .nix and .yaml files (#6)** | **Sibling drift caused by a later guard.** The three `apply_file_edits` branches were guarded in one validation commit; the semantic sibling predated that commit and was not revisited. Thus the diverging functions were not introduced together. | `286a2848` tests dispatch and generic file-edit behavior. No test asserts that an equivalent invalid Nix result is rejected through both `edit_file` and `edit_nix_file`. |
| 5. `search_single_channel` sets Nix `PATH`; sibling `classify_package` invokes bare `nix` and returns `Either` on errors | `1ea4ec73`, 2026-05-07, **fix(search_packages): fix broken search_packages nix execution and parsing, add "install type" to hint at Homebrew vs nix systempkgs (#91)** | No guard for `classify_package` was found. The `get_nix_path()` idiom and the bare classifier command were introduced in the **same commit**, not by later drift between commits. | **Same-commit sibling divergence.** The search and classifier functions were added/rewritten together by `1ea4ec73`; one received the environment setup while the other did not. The commit subject is the same for both branches. | `1ea4ec73` adds fixture tests for search output and classifier decisions, plus manual tests named in its message. No test exercises Finder-launched PATH resolution or asserts a failed classifier is distinguishable from `Either`; the code comment says to “let the agent decide.” |
| 6. Prompt rules require search/package-target and forbid protected files, but enforcement is incomplete | Search/install policy entered in `1ea4ec73`, 2026-05-07, **fix(search_packages): fix broken search_packages nix execution and parsing, add "install type" to hint at Homebrew vs nix systempkgs (#91)**; protected-file policy entered in `c6f9cdb1`, 2026-05-03, **feat(templates): add official nixmac modules** | `c6f9cdb1`, 2026-05-03, **feat(templates): add official nixmac modules** adds `ensure_nixmac_edit_allowed` for `.nixmac`; no code guard for “must call/search/follow `install_target`” or the `flake.nix`/`flake-modules` rules was found | **Mixed.** The `.nixmac` guard and its prompt rule are same-commit, but the package policy has no corresponding guard. Prompt policy therefore predates (or, for package policy, never receives) a complete call-site enforcement layer. | `c6f9cdb1` tests allowed `.nixmac/<module>/data.json`, metadata rejection, stray data rejection, Nix-file rejection, and secret-injection rejection. `1ea4ec73` tests package fixtures, not mandatory invocation or target adherence. |
| 7. Full coding-agent CLIs are spawned as inference endpoints without cwd/env/tool restrictions; arg lists are duplicated | `3ae1211d`, 2026-04-11, **feat: add CLI tool support for OpenCode, Codex, and Claude** | No guard commit found. `run_cli_process` adds a PATH and timeout, but no current-directory, environment scrubbing, or tool-restriction postcondition; the evolve and summary callers still construct argument lists independently | **Same-commit duplication, no later guard.** Both `build_args` in the general provider and the inline evolve `args` list were created by `3ae1211d`. No evidence found that one was copied from an earlier committed version of the other; the patch order cannot establish copy direction. | `3ae1211d` adds no provider behavior tests. No test asserts cwd, inherited environment, command restrictions, or parity between the two arg lists. |
| 8. Context-window selection uses provider-name substrings instead of authoritative model metadata | Base heuristic: `ea04eb90`, 2026-06-12, **ENG-502: Add direct OpenAI provider support (#388)**; the specific broad `contains("claude")`/`contains("gemini")` expansion is `7b166775`, 2026-07-11, **feat(ai-models): centralize all the info (#515)** | No guard/use of the fetched authoritative `context_length` was found | **Heuristic before metadata use.** The Rust capability function already existed; `7b166775` broadened substring matching and added model-name examples rather than consuming per-model context metadata. | `7b166775` adds table-driven tests that assert broad Claude/Gemini names map to 32K and unknown names use the fallback. Those tests encode the heuristic, not the metadata contract. No test compares the chosen window with provider-reported `context_length`. |

### Defect 7 copy direction

The repository history has no commit before `3ae1211d` containing either of the
two current CLI argument lists. Both files first appear in that commit. Their
identical `claude`, `codex`, and `opencode` shapes are therefore consistent with
copy-paste, but **no evidence found** proves whether `build_args` or the evolve
inline list was copied first. Treat this as a design duplication, not an
individual attribution.

### Tests and the shape of the fixes

The strongest example is `92786de3`: its test comment says, verbatim, “Bug 1:
build_verified latched true on the first passing build and was never cleared,”
but the test matrix only drives a failing `BuildResult` and an edit. The
unhandled `Err` branch is the same state invariant at a different transport
boundary and was not covered. Likewise, the semantic editor had tests for
successful AST operations while the later generic validator had tests for
`edit_file`; no cross-tool postcondition test joined those surfaces.

## Previously known

The prior documents did not all use the same vocabulary as this audit. The
classification below distinguishes an exact prior finding from a related one.

1. **Defect 1 — previously identified.** `apps/eval/wip/general-agent-improvements.md`
   (2026-07-21) says:

   > The engine has a sound `DoneGate`: edits invalidate verification, a successful
   > `build_check` restores it, and `done` is accepted only when the build is
   > verified. However, the no-tool terminal-response path sets an edited evolution
   > to `Generated` directly. Completion therefore depends on how the model stops,
   > not on the invariant the product intends to enforce.

   The same document specifies the exact regression: “one edit followed by a
   plain response must not become a successful generated result.” The follow-up
   `ba1e601d` exists only on a topic ref, so the finding was known but not landed
   on current `HEAD`.

1. **Defect 2 — partially identified.** The same 2026-07-21 document describes
   the intended gate as invalidating on edits and restoring on successful builds,
   but it does not name the `Err` branch. `92786de3` fixed only the two tested
   reproductions. Search of all refs found no later commit or revert specifically
   addressing pass→tool-error→`done`; this is an unclosed instance of a known
   invariant, not a wholly new class.

1. **Defect 3 — genuinely new in this audit.** The 2026-07-21 reports discuss
   semantic-editor output quality and buildability, including `;}` and no-op
   edits, but do not identify the false `edit_nix_file` description or the
   missing semantic post-write syntax check. The related passage says:

   > The semantic editor also produced the compact sequence `;}` in cases 23, 24,
   > 25, 26, 28, 29, 144, and 211. This is usually syntactically valid, but it is a
   > poor, avoidable diff and makes generated configuration harder to review. Case
   > 214 additionally shows that semantic operations can count as three edits even
   > when the final Git diff is empty.

   That is evidence of output-quality symptoms, not the missing validation
   postcondition. No prior follow-up or attempted fix for this exact
   promise/path mismatch was found.

1. **Defect 4 — partially identified.** `apps/eval/wip/general-agent-improvements.md`
   (2026-07-21) already records:

   > `edit_nix_file` calls `apply_semantic_edit` and then always returns
   > `ToolResult::EditSemantic` (around lines 524-537). The evolve loop consequently
   > appends an edit and invalidates build verification even if file content did not
   > change. This can inflate telemetry, provoke unnecessary builds, and leave an
   > empty final diff like case 214.

   It recommends a typed changed/no-op result. That is the semantic sibling's
   missing postcondition, but not the broader validation divergence between
   `apply_file_edits` and `apply_semantic_edit`. No landed cross-branch repair was
   found.

1. **Defect 5 — genuinely new.** Prior docs mention wrong package scope and the
   prompt's package-search expectations, but no prior document identifies the
   `PATH` asymmetry or the classifier's error-to-`Either` collapse. `1ea4ec73`
   itself acknowledges that the install target is “just a suggestion” and that
   there is “no reason the agent will respect it,” which is evidence of the
   prompt-only boundary, not a fix attempt.

1. **Defect 6 — previously identified.** `apps/eval/wip/arximboldi-agent-improvements.md`
   (2026-07-20) says:

   > The system prompt already says concrete requests are actionable and users expect
   > the agent to make necessary changes (`prompts/system.md`, lines 6 and 38-40).
   > The runtime should enforce that contract instead of relying on prose alone.

   The report specifically recommends a structured `already_satisfied` outcome
   and runtime correction for actionable turns. This is the same prompt-as-policy
   mechanism exposed by the mandatory `search_packages` and protected-file rules;
   only the narrow `.nixmac` path guard was implemented.

1. **Defect 7 — genuinely new.** The 2026-07-20/21 reports identify provider
   failures and missing timeout/evidence handling, but no prior audit identifies
   the CLI providers' missing cwd/env/tool restrictions or duplicated argument
   construction. No attempted fix or revert for this exact issue was found.

1. **Defect 8 — genuinely new.** The prior eval documents contain no context-window
   heuristic or authoritative `context_length` comparison. `7b166775` added
   broader heuristic tests after the capability function existed; no follow-up
   addressing the metadata source was found.

The older `docs/2026-05-03-audit.md` is about split Rust/TypeScript contracts,
manual mirrors, and untyped `serde_json::Value` returns. It contains no finding
for these eight evolve defects. The 2026-06-03 review follow-ups likewise
identify a `try_state` fallback and state ownership issue, not these agent-loop
paths.

### Fate of documented follow-ups

The 2026-07-21 combined plan explicitly turned the known findings into
`PR-4` (unified terminal states), `PR-11` (evidence-based convergence), and
`PR-12` (truthful semantic edits and clean insertion formatting). Git history
contains implementation commits for the terminal hardening on the topic refs
`origin/jp/evolve-phase0-hardening`: `ba1e601d` (2026-07-22, **fix(evolve):
gate the no-tool terminal path on build verification (N4)**), `38cd5a63`
(2026-07-22, **fix(evolve): complete a no-edit done as conversational, not
generated (N5)**), and `e5ccd1d7` (2026-07-22, **feat(evolve): record terminal
reason and build verification in telemetry**); and
`origin/jp/evolve-terminal-provider`: `daee128e` (2026-07-22, **fix(evolve):
gate the no-tool terminal path on build verification (N4)**), `f9489a5f`
(2026-07-22, **fix(evolve): complete a no-edit done as conversational, not
generated (N5)**), and `ac6cd878` (2026-07-22, **feat(evolve): record terminal
reason and build verification in telemetry**). None is an ancestor of current
`HEAD`.

`git log --all` found no implementation commit for the planned PR-12
semantic changed/no-op contract, no implementation commit for the prompt
evidence rules, and no revert explaining their absence. The evidence supports
“planned and left on abandoned/unmerged topic work,” not a claim about why a
particular person stopped it.

The four convergence follow-ups in
`apps/eval/wip/evolve-loop-convergence-followups.md` did land before the
2026-07-21 combined report: `66ccd2a0` (2026-07-19, **fix(evolve): stop
build-error truncation from dropping the root cause (#551)**), `08d30880`
(2026-07-19, **fix(evolve): break the rejected-done loop and stop doomed
sessions early (#552)**), and `d41683fe` (2026-07-20, **feat(evolve): curb
exploration thrash with repeat-call short-circuiting and decisive-exploration
guidance (#553)**). That is important context: the remaining defects are not
explained by simply failing to apply those four fixes.

## Systemic causes

### 1. Prompt-as-enforcement — confirmed, with a narrow exception

The clearest evidence is temporal and structural. `1ea4ec73` added the
`search_packages` install-target prose, including “You MUST call” and “the
action is invalid,” while its implementation returned a suggestion and did not
record a mandatory call/target decision in session state. `c6f9cdb1` added the
protected-file prose and, unusually, also added a real `.nixmac` chokepoint.
The remaining prompt rules around off-topic behavior, no-tool completion,
`flake.nix` protection, search-doc sequencing, and secret setup have no
corresponding state machine or tool gate.

For a reproducible count, I treated each explicit prohibition/requirement in
`prompts/system.md` as one rule and grouped explanatory examples under their
nearest rule. Of 20 such actionable rules audited (path safety, tool selection,
operation shape, build-before-done, search-doc protocol, secret protocol,
package-search protocol, tool-call protocol, terminal-response shape, protected
files, and edit/review rules), **7 have a code counterpart and 13 do not**.
The seven are path containment/normalization, operation-shape validation,
scalar/action validation, build verification for the `done` tool, `.nixmac`
allowlisting, tool-name/schema dispatch, and syntax validation on generic
`edit_file`. The count is intentionally scoped to executable requirements, not
style guidance; the conclusion is unchanged if adjacent bullets are split:
most behavior remains model-enforced.

This was not a contributor mistake: prose is cheaper to add than a durable
state transition, and the UI's tool descriptions make the prose look like a
contract even when only one caller is guarded.

### 2. Reproduction-scoped fixes — confirmed

`92786de3` is direct evidence: a comment describes a latch invariant, while the
new tests cover only `BuildResult(false)` and edit results. The `Err` branch is a
third way to leave the latch stale. `286a2848` is the parallel structural
example: tests validate the new generic writer, but no test enters the semantic
writer through the same Nix postcondition. `7b166775` adds tests for the names
that motivated the heuristic, thereby making the broad heuristic appear
supported without testing model metadata.

The process optimized for “reproduce this report” rather than “state the
invariant and enumerate every transition that can violate it.”

### 3. Guard-after-path — confirmed and refined

Defects 1, 3, and 4 show two variants. For defect 1 the guard existed first,
then a new terminal path bypassed it. For defects 3/4 the generic syntax guard
was added after semantic editing already existed and did not dominate it. The
common failure is not simply chronology: it is adding a guard without a
repository-wide inventory of exits and mutation paths.

### 4. Sibling drift — confirmed

Defect 5 has same-commit drift: two Nix subprocesses were authored together,
but only one received `get_nix_path()`. Defect 4 has cross-commit drift: generic
file branches were updated while semantic writes were left alone. Defect 7
repeats the shape at a larger boundary: two providers construct equivalent CLI
arguments independently. A required idiom exists, but there is no single
chokepoint or shared helper that makes omission impossible.

### 5. Agent-authored code reviewed by the same agent — not supported by evidence

The eight gap-introducing commits have human author identities in git:
`b488f9e3` (Scott McMaster), `0d88cf87` (Cooper Maruyama), `ff0a3be9`
(Scott McMaster), `286a2848` (Scott McMaster), `1ea4ec73` (Scott McMaster),
`c6f9cdb1` (Cooper Maruyama), `3ae1211d` (Cooper Maruyama), and `7b166775`
(Alex Shabalin). **0/8 (0%) carry an explicit AI author/co-author trailer.**
The later partial fix `92786de3` does carry `Co-Authored-By: Claude Opus 4.8`,
but it is not a gap-introducing commit.

Several subjects reference PRs and some bodies say “AI code review comments,”
but commit trailers contain no `Reviewed-by` evidence, and no commit body
proves an independent review of the specific invariant. Therefore the
proportion of introducing commits with evidence of independent review is
**no evidence found (0/8 by commit metadata)**. This does not claim that no
human review happened on the hosting service; the local history cannot prove
it.

### 6. Missing mutation chokepoint — confirmed

The code has separate model-to-side-effect routes: generic `edit_file`, semantic
`edit_nix_file`, secret injection, direct subprocess helpers, and terminal-state
branches. Validation, path policy, and state transitions are distributed among
tool descriptions, dispatch checks, file helpers, editor functions, and the
outer loop. The evidence is the exact asymmetry: `apply_file_edits` owns a
syntax postcondition while `apply_semantic_edit` writes directly; `done` owns a
verification check while plain text did not; and `search_single_channel` owns
Nix PATH while `classify_package` does not.

The absence of a chokepoint explains why adding one correct guard did not make
the whole product correct. It also explains why the defects cluster around
boundaries where model output becomes filesystem state, subprocess execution,
or terminal state.

## What would have caught this (ranked by leverage)

1. **One mutation/terminal chokepoint with executable postconditions.** Add an
   `apply_model_edit()` boundary owning path resolution, protected-file policy,
   write atomicity, Nix syntax postcondition, and a `Changed | Unchanged`
   result. `edit_file`, `edit_nix_file`, and secret injection must call it;
   tool modules must not call `fs::write` directly. Add one
   `resolve_terminal_state()` used by `done`, plain text, provider errors, and
   limit exits, with `build_verified` invalidated on every edit failure/success
   transition. This catches defects 1–4 and 6 at the architecture boundary.

1. **Single subprocess factory for Nix and coding CLIs.** Introduce a shared
   `run_nix_command()` that sets the canonical Nix PATH, cwd, Nix feature env,
   and error classification; use it for both search and derivation
   classification. Introduce a CLI-provider command builder that owns cwd,
   scrubbed environment, allowlisted args, timeout, and tool restrictions, and
   make both summary and evolve providers consume it. This catches defects 5
   and 7 and removes the duplicated arg-list review surface.

1. **Make policy typed and host-enforced, not prompt-enforced.** Record
   `search_packages` provenance and `install_target` in the session, then reject
   a package mutation without a matching search result/target. Represent
   protected paths as a code allow/deny policy (including the exact exception
   rules for `flake.nix` and `flake-modules`) and make prompt text generated
   from that policy. Model actionable no-op, clarification, refusal, and
   generated outcomes as distinct typed terminal states. This catches defect 6
   and the intent half of defect 1.

1. **Invariant-driven transition tests, not only reproductions.** For each gate,
   enumerate every transition: edit success, edit error, build pass, build
   failure, tool error, cancellation, plain response, `done`, and a batch with
   sibling tool calls. Assert the invariant after every transition. Add a
   cross-tool matrix that feeds equivalent invalid Nix through both edit tools,
   an environment test for Finder-like PATH, and a metadata-vs-heuristic test
   for every provider model. This would have caught defect 2's `Err` hole,
   defect 3/4's branch divergence, defect 5, and defect 8.

1. **Independent review gate for multi-file or invariant changes.** Require a
   reviewer other than the author/agent to inspect the changed call graph and
   transition matrix before merge; the review template should ask “what are all
   exits and mutation paths?” and “what test proves each?” Commit trailers or
   PR metadata should record the reviewer. This would have made the missing
   cross-path audit visible even when the local reproduction test passed.

1. **CI checks for architectural drift.** Add a narrow static check that forbids
   `fs::write` outside the mutation boundary, bare `Command::new("nix")`
   outside the subprocess factory, and provider-specific copies of CLI args.
   Add a prompt-contract check requiring every MUST/ONLY/NEVER mutation rule to
   name a corresponding executable policy symbol. This turns the sibling and
   prompt-as-enforcement findings into merge-time failures rather than audit
   discoveries.

1. **Use authoritative provider metadata as the only context-window input.**
   Carry OpenRouter's `context_length` (and the equivalent for other providers)
   through the model catalog into the Rust request allocator, with an explicit
   conservative fallback only for truly unknown models. Test a table of real
   model IDs against the catalog and reject substring-derived values. This is
   lower leverage than the mutation boundary but directly prevents defect 8.

## Bottom line

The defects are not eight unrelated slips. They are repeated boundary failures:
a prompt sentence stands in for a state transition, a guard is added without
an exit inventory, sibling functions silently diverge, and tests prove only the
reported reproduction. The prior eval work already named the most visible
terminal and semantic symptoms, but the fixes remained sliced by symptom and
were not merged into one enforced contract. The highest-leverage change is to
make model output pass through a small number of code-owned chokepoints whose
postconditions are impossible for a new tool or terminal path to bypass.
