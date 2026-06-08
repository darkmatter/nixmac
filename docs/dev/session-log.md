# Dev Session Log

<!-- SESSION_LOG_START -->

## Goal

Build a unified OTEL telemetry pipeline for the nixmac Tauri app using OpenTelemetry libraries/SDKs, with Sentry and PostHog as sinks, replacing the current separate analytics and Sentry integrations.

## Current phase

Implementation milestone — core pipeline built, tests passing, migration partially complete.

## Current state

**All 4 implementation tasks completed.** Both Rust and JS telemetry modules are created, call sites migrated, old analytics module deleted. Old sentry module retained during migration period.

### Verification results

- `tsc --noEmit` ✅ (only pre-existing error in `summary-or-diff.tsx`)
- `vitest run` ✅ (116 tests passing — 16 analytics tests removed with module)
- `cargo check` ✅
- `cargo test` ✅ (396 tests passing)

## Decisions & constraints

- Must use `@opentelemetry` libraries and SDKs — not custom event types
- Sentry and PostHog both attach to the same OTEL pipeline as sinks
- PostHog stays direct in JS (not via OTEL) — its OTEL exporter is JS-only and needs DOM context
- Sentry via OTLP from Rust backend — DSN parsed to construct OTLP traces/logs URLs
- `sendDiagnostics` pref gate at pipeline level (both Rust and JS respect it)
- PII scrubbing at exporter level (Rust: `scrub.rs`, JS: `sanitize.ts`)
- No Rust-side PostHog — PostHog lives in the JS/webview layer
- Additive migration: old sentry module kept alongside new OTEL pipeline until OTEL→Sentry is proven in production
- Conservative git workflow — no commit/push without explicit authority

## Evidence (files/commands/results)

### Rust side — new files

- `apps/native/src-tauri/src/telemetry/mod.rs` — module declarations
- `apps/native/src-tauri/src/telemetry/init.rs` — parses Sentry DSN → OTLP URLs, builds SdkTracerProvider + SdkLoggerProvider, registers globally, TelemetryGuard with flush-on-drop
- `apps/native/src-tauri/src/telemetry/ipc.rs` — `otel_forward_span` Tauri command, scrubs PII, logs
- `apps/native/src-tauri/src/telemetry/scrub.rs` — PII/secret regexes ported from sanitize.ts
- `apps/native/src-tauri/Cargo.toml` — added: opentelemetry 0.29, opentelemetry_sdk 0.29, opentelemetry-otlp 0.29, opentelemetry-appender-tracing 0.29, tracing-opentelemetry 0.30, url 2
- `apps/native/src-tauri/src/main.rs` — added `mod telemetry;`, `telemetry::ipc::otel_forward_span` in invoke_handler, `app.manage(telemetry::init::init_telemetry(send_diagnostics))` in setup

### JS side — new files

- `apps/native/src/lib/telemetry/types.ts` — TelemetryEvent taxonomy + TelemetryProvider interface
- `apps/native/src/lib/telemetry/sanitize.ts` — PII scrubbing (ported from sentry/sanitize.ts)
- `apps/native/src/lib/telemetry/forwarding-processor.ts` — ForwardingSpanProcessor → invoke("otel_forward_span")
- `apps/native/src/lib/telemetry/provider.ts` — WebTracerProvider + PostHog direct
- `apps/native/src/lib/telemetry/init.ts` — initTelemetry() bootstrap
- `apps/native/src/lib/telemetry/instance.ts` — module singleton
- `apps/native/src/lib/telemetry/noop.ts` — no-op provider
- `apps/native/src/lib/telemetry/context.tsx` — TelemetryContextProvider / useTelemetry
- `package.json` — added: @opentelemetry/api, @opentelemetry/sdk-trace-web, @opentelemetry/core, @opentelemetry/resources, @opentelemetry/semantic-conventions

### Migrated call sites

- `apps/native/src/main.tsx` — initTelemetry() + attachSentry() (both active), TelemetryContextProvider
- `apps/native/src/App.tsx` — useTelemetry(), captureEvent({ name: "app_ready" })
- `apps/native/src/hooks/use-evolve.ts` — getTelemetry().captureEvent() for evolve_started/completed/failed
- `apps/native/src/hooks/use-rollback.ts` — getTelemetry().captureEvent() for rollback_performed
- `apps/native/src/components/widget/settings/general-tab.tsx` — useTelemetry(), captureEvent(), setEnabled()
- `apps/native/src/e2e/dom-snapshots.ts` — sanitizeDiagnosticText from telemetry

### Deleted

- `apps/native/src/lib/analytics/` — entire directory (8 files, 16 tests) — zero external imports

### Still retained (migration period)

- `apps/native/src/lib/sentry/` — 3 files — still imported by main.tsx for attachSentry/captureRenderError
- Rust `sentry` + `tauri-plugin-sentry` crates — still active alongside OTEL
- `@sentry/react` ErrorBoundary — stays for now

## ✅ What worked

- Parallel delegation of Rust and JS telemetry modules to deep category agents
- The Vortex/Nexus-Mods ForwardingSpanProcessor pattern adapted for Tauri IPC
- Sentry DSN → OTLP URL derivation (parse DSN host + project_id → construct traces/logs URLs)
- TelemetryGuard stored via `app.manage()` instead of local binding (avoids premature Drop in setup closure)
- PII scrub module ported cleanly from TS to Rust
- Additive migration approach: both old and new pipelines run simultaneously

## ❌ What didn't work

- `tracing→OTEL` log bridge can't attach to existing subscriber (tracing only allows one global subscriber, already initialized in main.rs before telemetry init). Bridge is constructed best-effort via `try_init()`, documented as follow-up.
- `opentelemetry-rust` has no clean "inject external span" API, so `otel_forward_span` currently logs forwarded spans rather than reconstructing them into the TracerProvider. Documented as follow-up.
- Initial `let _telemetry_guard` in setup closure would Drop at setup-end (killing shared provider). Fixed by using `app.manage()`.

## 🧩 Not attempted / remaining

- **Remove old `src/lib/sentry/` module** — blocked until OTEL→Sentry exporter is proven in production
- **Remove Rust `sentry` + `tauri-plugin-sentry` crates** — same blocker
- **Full span reconstruction in Rust** — `otel_forward_span` currently logs; needs opentelemetry-rust API work or custom span injection
- **Wire tracing→OTEL log bridge** — requires refactoring main.rs subscriber setup to host the bridge layer
- **Ring buffer for offline/error export** — Vortex pattern (buffer spans, export on error)
- **OTEL context propagation across Tauri IPC** — pass traceId/spanId in Tauri command params for parent span linking
- **Production validation** — verify spans actually reach Sentry via OTLP

## ⏭️ Next steps (checklist)

- [ ] Test the OTEL→Sentry pipeline end-to-end (send a test span, verify it appears in Sentry)
- [ ] Decide when to remove old sentry module (JS side) and `sentry`/`tauri-plugin-sentry` crates (Rust side)
- [ ] Implement full span reconstruction in `otel_forward_span` (inject forwarded spans into Rust TracerProvider)
- [ ] Refactor main.rs subscriber setup to host OTEL log bridge layer
- [ ] Implement ring buffer pattern for offline/error-triggered span export
- [ ] Add OTEL context propagation (traceId/spanId) across Tauri IPC boundary
- [ ] Add tests for new telemetry module (JS: provider, forwarding-processor, sanitize; Rust: scrub, dsn parsing)
- [ ] Git commit (when authorized)

<!-- SESSION_LOG_END -->
