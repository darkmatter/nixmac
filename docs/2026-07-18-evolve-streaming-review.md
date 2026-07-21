# Evolve streaming branch review

**Reviewed branch:** `jp/evolve-streaming`\
**Comparison base:** `origin/jp/evolve-focus-history`\
**Reviewed on:** 2026-07-18

## Summary

The branch is a strong implementation of the planned streaming experience: it
adds live build output, provider response streaming, streamed tool reasoning,
bounded visible tails, cancellation support, and focused UI coverage. The
frontend build and focused tests pass, and the Rust changes compile and format
cleanly.

Before streaming is promoted beyond the developer flag, the Ollama byte parser
should be made UTF-8 safe. The branch should also distinguish retries, anchor
the active-step timer to semantic activity rather than individual chunks, and
bound the stream data retained in frontend state. These issues do not invalidate
the overall design, but they affect correctness and the experience of longer
runs.

## Resolution (2026-07-18)

All five findings were verified against the code and confirmed real; they and
most of the suggestions are addressed on `jp/evolve-streaming` as one commit
per item:

- **Finding 1 (UTF-8 across Ollama chunks): fixed** in `adb49cfa` — raw bytes
  buffer in an extracted `NdjsonBuffer` and decode only as complete records;
  includes the suggested decoder extraction, tested across every possible
  chunk boundary plus multi-record chunks, spanning records, unterminated
  tails, and blank lines.
- **Finding 2 (retries concatenate discarded output): fixed** in `8746cca5` —
  the delta callback carries `StreamEvent::{Delta, Reset}`; every Ollama retry
  path resets the visible tail via a hidden `streamReset` marker and streams a
  visible "→ Response interrupted; retrying..." line (also covering the
  "make retries visible" UX item). Console and transcripts keep the discarded
  attempt, labeled by the marker.
- **Finding 3 (timer resets per chunk): fixed** in `73ee9b04` — the
  active-step timer anchors to semantic events only; the header clock keeps
  its per-event anchor because its math incorporates the latest backend
  timestamp. Includes the suggested fake-timer component test.
- **Finding 4 (unbounded retained stream state): fixed** in `ace55605`
  (consecutive stream chunks coalesce into one capped event in the ViewModel;
  semantic events and reset markers still append) and `26d80790` (transcript
  appends flow through a single ordered writer task, including the
  prompt/result lines, with an ordering test).
- **Finding 5 (surrogate pairs): fixed** in `3ea587df` — pairs combine across
  fragment boundaries, holding only while the buffered bytes could still be
  an escape prefix; lone surrogates drop as before.

From the suggestion sections: tool presentation metadata is centralized in
`b6f2b5be` (`types::tool_action_label` feeds both the timeline summaries and
the stream announcements), build-log tail-following pauses while scrolled up
in `492338b1`, and `dc256f35` adds the unsupported-provider fallback (a
streamed call that fails before producing output retries blocking and
disables streaming for the rest of the run) plus a warning when streamed
usage is missing.

Deferred, with reasons: the Ollama request/retry consolidation (the two paths
now share the NDJSON decoder, announcements, and converters; restructuring the
freshly fixed retry loops without a live-provider harness is risk without a
current payoff), timer-driven `DeltaBatcher` flushing (the trailing fragment
flushes on completion; the residual gap is text arriving slightly late during
a mid-response pause, not worth a flusher task while the feature is
dev-flagged), the single progress-state selector (coalescing removed the perf
pressure that motivated it), and the semantic-build-status presentation (a
product decision; the accepted design deliberately shows the log).

Rejected: normalizing trailing whitespace in the generated bindings —
`origin/main`'s `types.ts` already contains 455 such lines; it is the specta
generator's output style, and normalizing only the new lines would make the
file internally inconsistent.

## Findings

### 1. High: preserve UTF-8 across Ollama transport chunks

**Location:** `apps/native/src-tauri/src/evolve/providers/ollama.rs:377`

The Ollama streaming path converts each HTTP body chunk independently with
`String::from_utf8_lossy`. HTTP chunk boundaries are arbitrary and may split a
multibyte UTF-8 character. In that case, the two partial byte sequences are
each replaced with the Unicode replacement character.

This can corrupt streamed prose and tool arguments. For example, a tool call
containing a path such as `café.nix` could be assembled with replacement
characters and target the wrong path.

#### Recommendation

Keep the response buffer as bytes until a complete NDJSON record has arrived:

1. Append each HTTP chunk to a `BytesMut` or `Vec<u8>` buffer.
1. Split completed records on the newline byte.
1. Decode each complete record as UTF-8.
1. Parse its JSON and emit its content delta immediately.

This preserves the current streaming cadence. Ollama's newline terminates a
protocol record, not a user-visible prose line; each record can still contain a
token or short fragment. The user continues to see incremental output while a
character split across network packets is decoded safely.

`tokio_util::io::StreamReader` with `AsyncBufReadExt::lines`, or a small
`BytesMut`-based NDJSON decoder, would both be suitable.

### 2. Medium: invalidate partial output when Ollama retries

**Locations:**

- `apps/native/src-tauri/src/evolve/providers/ollama.rs:332-354`
- `apps/native/src-tauri/src/evolve/providers/ollama.rs:390-404`

Content and tool announcements are emitted as soon as they arrive. If a
mid-stream tool-call parse error occurs, the provider retries, but nothing
marks the already-emitted output as belonging to a discarded attempt.

The active tail can therefore concatenate the abandoned response with the
retry. Both attempts also remain in the Console and session transcript without
a clear boundary.

#### Recommendation

Add a stream attempt identifier and either:

- emit a `streamReset`/`providerRetry` event that causes the active tail to
  discard the previous attempt; or
- make the frontend retain deltas only for the latest attempt.

The Console and transcript should preserve the failed attempt for diagnostics,
but label it explicitly as discarded.

### 3. Medium: do not reset the active-step timer for every chunk

**Location:** `apps/native/src/components/widget/overlays/evolve-progress.tsx:739-756`

`lastEventReceivedAt` resets whenever `events.length` changes. Streaming adds
events roughly every 120 ms, so the active-row timer can remain at `0s` during a
long provider request or build check. This undermines the timer's role as a
liveness and duration indicator.

The header's total elapsed time remains broadly correct because it incorporates
backend timestamps; the problem is the active-step timer passed to `ActiveRow`.

#### Recommendation

Anchor the active timer to a semantic focus transition rather than the latest
event. A focus key could be derived from the current API request, tool call,
question, or analysis step. Stream deltas belonging to the same focus key would
update detail without restarting the clock.

Add a component test that streams several deltas over multiple simulated
seconds and verifies that the active-row duration continues increasing.

### 4. Medium: actually bound retained stream state

**Locations:**

- `apps/native/src/components/widget/overlays/evolve-progress.tsx:137-179`
- `apps/native/src/viewmodel/evolution.ts:47-59`
- `apps/native/src-tauri/src/types.rs:556-564`

The UI displays only the last 500 build-log lines and 320 streamed characters,
but the complete sequence of `buildCheck` and `streamDelta` events remains in
`evolveEvents`. Each incoming event copies the array, and every event also
starts an asynchronous transcript append.

Long verbose builds and multi-iteration provider streams can therefore retain
thousands of hidden events. The component repeatedly filters and scans that
growing array on every render. The constant named `BUILD_LOG_MAX_LINES` is a
display cap, not a ring buffer over retained state.

#### Recommendation

Keep durable semantic events in `evolveEvents`, but coalesce ephemeral stream
events in the ViewModel:

- replace the latest delta event for the active stream instead of appending a
  new event every time;
- maintain bounded build and provider tails separately; or
- use a reducer that caps consecutive stream events while preserving semantic
  boundaries.

Raw chunks may still be sent directly to the Console and transcript. Transcript
writes should ideally flow through an ordered writer task rather than spawning
one independent task per high-frequency event.

### 5. Low: support JSON surrogate pairs in streamed thoughts

**Location:** `apps/native/src-tauri/src/evolve/providers/mod.rs:143-190`

The incremental thought decoder handles each `\uXXXX` escape independently.
Non-BMP characters encoded as UTF-16 surrogate pairs, such as
`\uD83D\uDE00`, are rejected by `char::from_u32` and disappear from the
streamed thought. The final parsed tool call remains correct, so this is a
transient display issue rather than tool-execution corruption.

#### Recommendation

Track a pending high surrogate and combine it with the following low surrogate,
or use a standards-compliant incremental JSON string decoder. Add tests covering
surrogate pairs split both within and between argument fragments.

## Reuse, abstraction, and readability

### Extract a testable Ollama stream decoder

The Ollama streaming implementation currently combines HTTP handling, byte
framing, JSON decoding, response assembly, delta emission, usage extraction,
error classification, and retries in one method. Extracting an NDJSON decoder
would make arbitrary byte fragmentation and error records easy to test without
an HTTP server.

At minimum, cover:

- a newline and a multibyte character split at every possible byte boundary;
- several records in one HTTP chunk;
- one record spread across several chunks;
- `{"error": ...}` records;
- missing final `done` records;
- content, tool calls, and usage assembly.

### Share Ollama request and retry plumbing

The blocking and streaming completion paths duplicate request construction,
request/response logging, HTTP error handling, retry guidance, empty-response
handling, usage conversion, and final message conversion. A common retry loop
with separate `request_once_blocking` and `request_once_streaming` operations
would reduce drift while keeping the two response transports explicit.

### Centralize tool presentation metadata

`tool_call_announcement` in `providers/mod.rs` duplicates the tool-label mapping
in `EvolveEvent::tool_call` in `types.rs`. Introduce a shared helper or tool
presentation descriptor that owns the generic action label. The final timeline
summary can then enrich that base label with arguments once they are available.

### Make delta flushing timer-driven

`DeltaBatcher` flushes only when another delta arrives or the completion ends.
A delta received inside the 120 ms throttle window can therefore remain hidden
through a later pause. A small channel with one periodic flusher task would
provide a true maximum display latency and eliminate the mutex from the
provider callback.

### Derive frontend progress state once

`EvolveProgress` independently filters visible events and scans for token
progress, pending questions, build tails, stream tails, and current focus. A
single reducer or memoized selector would make the state transitions easier to
understand and reduce work when stream event rates are high.

## User-experience improvements

### Let users pause build-log tail following

`BuildLogTail` always scrolls to the bottom whenever `lines` changes. A user who
scrolls upward to inspect an error is immediately pulled back down by the next
chunk. Track whether the inner log is near the bottom and resume tail-following
only when it is, with a small "Jump to latest" affordance otherwise.

### Prefer semantic status with optional raw detail

Verbose Nix output is valuable for trust and diagnosis but can be noisy. Show a
compact semantic build status and a small recent tail by default, with a
"Show build log" expansion for the full bounded view.

### Make retries visible

When a provider response is interrupted, show a short status such as
"Response interrupted; retrying...". This explains the pause and makes clearing
the discarded partial response feel intentional.

### Fall back when streaming is unsupported

Some OpenAI-compatible endpoints may reject `stream_options` or omit usage in
the final chunk. Where possible, retry once through the non-streaming path and
record that the provider does not support streaming, rather than failing the
entire evolution. Missing usage also needs an explicit policy so enabling
streaming does not silently weaken the session token budget.

## Verification performed

- `bun x vitest run --project=unit` for the evolve progress and overlay tests:
  39 tests passed.
- `bun run build`: passed.
- `cargo check --manifest-path apps/native/src-tauri/Cargo.toml`: passed.
- Targeted Rust tests for thought extraction, OpenAI tool-call assembly, and
  build-output events: passed.
- `cargo fmt --manifest-path apps/native/src-tauri/Cargo.toml -- --check`:
  passed.
- `bun run lint`: completed with zero errors and existing repository warnings.
- `git diff --check origin/jp/evolve-focus-history...HEAD`: reports trailing
  whitespace in generated TypeScript binding lines. Either normalize those
  generated files or adjust the generator so regenerated output remains clean.

## Suggested order of fixes

1. Make Ollama NDJSON framing byte-safe and add fragmentation tests.
1. Add stream attempt/reset semantics for retries.
1. Anchor the active timer to semantic focus transitions.
1. Coalesce or bound ephemeral events in frontend state and serialize transcript
   writes.
1. Consolidate duplicated provider and tool-presentation code.
1. Refine build-log interaction and unsupported-provider fallback before
   enabling streaming by default.
