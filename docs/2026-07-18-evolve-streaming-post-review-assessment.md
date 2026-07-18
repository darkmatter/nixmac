# Evolve streaming post-review assessment

**Reviewed branch:** `jp/evolve-streaming`\
**Review document:** `docs/2026-07-18-evolve-streaming-review.md`\
**Reviewed on:** 2026-07-18

## Summary

The post-review work is strong and correctly addresses most of the original
findings. In particular, the Ollama byte framing, retry boundaries, active-step
timer, bounded frontend state, transcript ordering, and streamed JSON surrogate
handling are materially improved and well tested.

The resolution should not yet be considered fully complete. Two medium-priority
issues remain: coalesced events cause the header elapsed clock to overcount, and
the non-streaming fallback retries every pre-delta provider failure rather than
only failures that mean streaming is unsupported. There are also two smaller
risks around retry-status visibility and transcript flushing.

## Resolution (2026-07-18)

All four findings were verified and are addressed on `jp/evolve-streaming`,
one commit per finding:

- **Finding 1 (header clock overcounts): fixed** in `c355747` — the arrival
  anchor keys on the last event's identity instead of the array length, so a
  coalesced in-place replacement re-arms it while an untouched array does
  not. Includes the suggested constant-length replacement regression test.
- **Finding 2 (fallback retries unrelated failures): fixed** in `54d55e74` —
  the trait gains `supports_streaming` (true only for the OpenAI-compatible
  and Ollama providers, so the CLI provider never runs its blocking call
  twice), and the blocking retry fires only for rejection-shaped statuses
  (400/404/405/415/422/501) via the new
  `indicates_streaming_unsupported` helper, with tests covering auth,
  rate-limit, server, and transport errors staying un-retried. The
  missing-usage warning
  is gated the same way. The explicit-status classification was chosen over a
  dedicated error variant because the rejection arrives as an ordinary HTTP
  error from the endpoint; the capability half of the recommendation is
  adopted as proposed.
- **Finding 3 (retry notice buffered): fixed** in `8868873c` — Reset is now
  the whole semantic operation: the batcher clears, emits the hidden boundary
  marker, and emits the visible "Response interrupted; retrying..." line
  directly, bypassing the flush throttle; providers just signal Reset.
- **Finding 4 (no durability point): fixed** in `b7301bb8` — the writer queue
  accepts a barrier item acknowledged once everything enqueued before it has
  been written, and `run_evolve` awaits it at every exit (success, failure,
  cancel). The ordering test asserts against the barrier instead of polling.

Verified afterwards: 713 backend tests, 298 frontend tests, typecheck, lint at
the existing baseline, and the evolve storybook snapshots unchanged.

## Post-resolution review (2026-07-18)

Findings 1, 3, and 4 are resolved. Finding 2 remains open: the provider
capability correctly prevents the CLI provider from executing its blocking call
twice, but the HTTP-error classification is not yet specific enough to establish
that streaming is unsupported.

### Open: distinguish an unsupported stream from other request errors

**Locations:**

- `apps/native/src-tauri/src/evolve/providers/mod.rs:318`
- `apps/native/src-tauri/src/ai/provider_errors.rs:54`
- `apps/native/src-tauri/src/evolve/mod.rs:1245`

`ProviderError::indicates_streaming_unsupported` currently returns true for
every HTTP 400, 404, 405, 415, 422, or 501 response. Those statuses do not by
themselves mean that the endpoint rejected streaming. They also represent
ordinary failures that the blocking request will repeat, including:

- an Ollama model-not-found response (commonly 404);
- a context-window or invalid-token-limit response (400; the provider tests
  already construct this case);
- malformed tools or unsupported model parameters (400/422); and
- a wrong endpoint or other routing error (404/405).

These errors still cause a second, unnecessary request. That can delay the
useful error, duplicate expensive work, or potentially issue a second billable
completion.

The classification can also miss the intended fallback. `async-openai`'s
normal `ApiError` does not retain the HTTP response status. The local
`classify_openai_error` maps an unrecognized symbolic error code to 500. A
standard OpenAI-shaped 400 response whose message or `param` says that
`stream_options` is unsupported can therefore become a 500 and never reach the
blocking fallback.

The current unit test verifies the selected status list, so it encodes the
classification assumption rather than exercising representative provider
errors.

#### Required resolution

Classify unsupported streaming at the provider boundary using structured error
information. A dedicated `ProviderError::StreamingUnsupported` variant is the
clearest contract: each streaming provider can produce it only when its error
specifically identifies `stream`, `stream_options`, or unsupported SSE behavior.
If the existing error variant is retained, classification should at least
inspect structured fields such as `param == "stream_options"` and narrowly
matched provider messages instead of accepting a status alone.

Add tests proving that:

- an explicit unknown/unsupported `stream_options` error does retry blocking;
- an unsupported streaming/SSE error does retry blocking;
- a 400 context-window error does not retry;
- a 404 model-not-found error does not retry;
- unrelated 400/422 validation errors do not retry;
- authentication, rate-limit, server, and transport errors remain un-retried;
  and
- the CLI provider continues to execute only once.

Finding 2 should remain open until those cases are distinguished. The
`supports_streaming` addition is still a valid partial resolution.

#### Resolution (2026-07-18, second pass)

Fixed in `7b6e1b21`, adopting the dedicated-variant recommendation. The
status-list classification is gone;
`ProviderError::StreamingUnsupported` is produced at the provider
boundary by `classify_streaming_rejection`, which matches only a
structured `ApiError` whose `param` is `stream`/`stream_options` or
whose message names those parameters as rejected, or states that
streaming/SSE is unsupported. The classifier runs at both the request
site and the mid-stream error site, since some proxies accept the
request and only then reject streaming via an SSE error payload — this
also sidesteps the `classify_openai_error` unknown-code-to-500 mapping
entirely, because classification happens before status normalization.

Tests cover the required cases: `stream_options` rejected via `param`
and via message, an explicit streaming-unsupported message, a 400-style
context-window error, model-not-found, an unrelated validation error,
a non-API transport error, and the CLI provider staying off the
streaming path (`supports_streaming` is false, so it can never execute
twice). Rate-limit/auth/server statuses cannot classify by
construction — only the dedicated variant triggers the fallback, and
nothing maps a status to it.

## Findings

### 1. Medium: elapsed time runs too fast during coalesced streaming

**Locations:**

- `apps/native/src/viewmodel/evolution.ts:89`
- `apps/native/src/components/widget/overlays/evolve-progress.tsx:767`

The ViewModel now coalesces consecutive stream chunks by replacing the latest
event. This keeps `events.length` unchanged while updating the replacement
event's backend timestamp.

The header clock, however, resets `lastEventReceivedAt` only when
`events.length` changes. Its elapsed-time calculation then combines the newer
backend timestamp with the time elapsed since the first coalesced event arrived.
That interval is counted twice.

For example, if a delta with a 10-second backend timestamp establishes the
frontend anchor, and a replacement delta with a 12-second timestamp arrives two
seconds later, the header calculates 12 + 2 and displays 14 seconds. The drift
continues to grow during sustained streaming.

This means the resolution document's statement that the header retains its
per-event anchor is not accurate after the event-coalescing change.

#### Recommendation

Reset the arrival anchor when the last event object changes, or expose an
explicit event-arrival sequence from the ViewModel. Depending only on the last
timestamp is less robust because multiple events can share a millisecond.

Add a component test that replaces a stream event with a newer timestamp while
keeping the array length unchanged, then verifies that the header does not
double-count the intervening time.

### 2. Medium: non-streaming fallback retries unrelated failures

**Location:** `apps/native/src-tauri/src/evolve/mod.rs:1217`

The fallback retries through `completion` whenever `completion_streaming` fails
before the first delta. The absence of a delta does not establish that streaming
is unsupported. This path also catches:

- authentication failures;
- rate limits;
- invalid requests and context-window errors;
- DNS, connection, and other transport failures; and
- server failures before the first response chunk.

It also applies to providers that use the trait's default
`completion_streaming` implementation. For the CLI provider, that default
already calls the blocking `completion` method, so a failed CLI invocation is
executed twice.

The retry can therefore delay useful errors, worsen rate limiting, duplicate an
expensive request, or potentially bill for a second completion when the first
request was accepted but its stream failed before delivering a delta.

#### Recommendation

Represent unsupported streaming explicitly, for example with a provider
capability or a `ProviderError::StreamingUnsupported` variant. Retry through the
blocking path only for that condition. Add coverage for authentication, rate
limit, transport, CLI, and explicitly unsupported-stream cases.

### 3. Low: the retry message is not reliably visible during the retry

**Locations:**

- `apps/native/src-tauri/src/evolve/providers/ollama.rs:510`
- `apps/native/src-tauri/src/evolve/mod.rs:776`

`announce_stream_retry` emits a reset followed by the explanatory delta
"Response interrupted; retrying...". The reset event is emitted immediately,
but the message still passes through `DeltaBatcher`'s 120 ms throttle.

If the previous flush happened less than 120 ms earlier, the message remains
buffered until another provider delta arrives or the retry completes. The reset
marker itself is hidden from the active stream tail, so the progress UI can
continue showing the previous semantic focus during exactly the pause the
message is intended to explain.

#### Recommendation

Make retry a dedicated, immediately visible event, or provide an explicit
force-flush operation for the retry announcement. A structured retry event would
also avoid using a streamed text fragment to represent a semantic state change.

### 4. Low: transcript ordering is fixed, but completion is not acknowledged

**Locations:**

- `apps/native/src-tauri/src/state/session_log.rs:137`
- `apps/native/src-tauri/src/commands/evolve.rs:53`

The single writer task correctly preserves enqueue order, resolving the original
race between independently spawned append tasks. The command now also queues the
prompt and final result through that writer.

However, the result is fire-and-forget. `run_evolve` clears the active session
path and returns without waiting for the queued result or preceding events to
reach disk. An application shutdown immediately afterward can lose the end of
the transcript. The ordering test verifies eventual order by polling the file,
but it does not establish a completion guarantee at the command boundary.

#### Recommendation

Add a queue barrier or a queue item carrying a oneshot acknowledgement, and
await it before `run_evolve` returns. This preserves the ordered writer design
while restoring a clear durability point for the final result.

## Assessment of the recorded resolutions

The following resolutions were reviewed and appear correct:

- **Finding 1:** Ollama now buffers raw bytes, frames complete NDJSON records,
  and only then decodes them. This prevents network chunk boundaries from
  corrupting multibyte UTF-8 while preserving incremental provider output.
- **Finding 2, core correctness:** a reset boundary separates abandoned Ollama
  output from the retry, so the active tail no longer concatenates attempts.
  The visibility claim still has the batching caveat described in finding 3
  above.
- **Finding 3, active-step timer:** streamed deltas and build chunks no longer
  restart the active-step timer. The new header-clock interaction described in
  finding 1 above is separate and comes from combining this work with event
  coalescing.
- **Finding 4, retained state:** consecutive provider and build chunks are
  coalesced into bounded events. The ordered transcript writer fixes emission
  order, subject to the final-flush caveat described in finding 4 above.
- **Finding 5:** the incremental thought decoder combines UTF-16 surrogate pairs
  across fragment boundaries and covers split and lone-surrogate cases.
- Tool presentation labels are now shared rather than duplicated.
- Build-log tail following pauses when the user scrolls away from the bottom.
- Leaving generated binding whitespace unchanged is reasonable because the
  existing generated file already follows that style.

The deferred Ollama request/retry consolidation, unified frontend progress
selector, and semantic build presentation remain reasonable deferrals while the
feature is experimental. Deferring timer-driven delta flushing has a visible
consequence for retry announcements, but that can be addressed narrowly with an
immediate semantic retry event rather than requiring a general flusher task.

## Verification

The following checks passed against the post-review branch:

- focused frontend tests: 52 tests across four files;
- provider tests: 17 tests;
- session-log tests: 4 tests;
- `cargo check`;
- `cargo fmt --check`;
- frontend TypeScript and production Vite build; and
- repository lint with zero errors (the existing warning baseline remains).

## Conclusion

Most original review findings have been resolved cleanly, and the feature is in
substantially better shape. Before treating the resolution as complete, the
header-clock anchor and overly broad non-streaming fallback should be corrected.
The retry-message flush and transcript completion acknowledgement are smaller
follow-ups but would make the documented UX and durability guarantees accurate.
