# Product Telemetry Event Contract

Status: v1 follow-up contract for ENG-230.
Scope: native nixmac product analytics captured from the Tauri WebView.

## Provider

PostHog is the product analytics provider for nixmac native product events.
Use the dedicated nixmac PostHog project, not a shared darkmatter product
project, so activation and product-usage funnels stay isolated.

The app uses Cooper's merged telemetry architecture:

- Product analytics: explicit `posthog-js` capture calls from the WebView.
- Diagnostics/errors: OpenTelemetry/Sentry path gated by diagnostics consent.
- App code: a single `TelemetryProvider` abstraction with separate product and
  diagnostics gates.

## Privacy Rules

Product analytics must never include prompts, config contents, diffs, logs,
file paths, provider responses, raw errors, raw requests, raw responses, names,
email addresses, API keys, or machine/user identifiers.

Passive PostHog collection must stay disabled:

- `autocapture: false`
- `capture_pageview: false`
- `capture_pageleave: false`
- `disable_session_recording: true`

Every product event must pass through the event/property allowlist in
`apps/native/src/lib/telemetry/sanitize.ts` before `posthog.capture`.
PostHog's global `sanitize_properties` hook must also stay enabled as a
defense-in-depth backstop for SDK-added properties and future direct captures.
The provider must register these privacy super-properties for every event:

- `$process_person_profile: false`
- `$geoip_disable: true`
- `$ip: null`

The provider must also register these non-user super-properties for dashboard
filtering:

- `environment`
- `release`

## Consent

Product analytics and diagnostics are separate preferences.

- `productAnalyticsEnabled` controls PostHog product-event capture.
- `sendDiagnostics` controls diagnostics/error reporting.

The ENG-230 product requirement is opt-out product telemetry, so
`productAnalyticsEnabled` defaults to `true` when prefs are readable and the
preference has not been set. If prefs cannot be read, product analytics and
diagnostics both fail closed for that session. Diagnostics remain default-off.

Turning product analytics off must prevent future PostHog product events.
Turning diagnostics off must not change the product analytics setting.
Diagnostics opt-in/out events are product analytics events; they are only sent
while product analytics is enabled.

## Event Registry

Initial ENG-230 product events:

- `app_launched`
  - allowed properties: `environment`
- `app_ready`
  - allowed properties: `boot_ms`
- `evolve_started`
  - allowed properties: `provider`, `has_custom_model`
- `evolve_completed`
  - allowed properties: `step`
- `evolve_failed`
  - allowed properties: `stage`
- `rollback_performed`
  - allowed properties: none
- `settings_changed`
  - allowed properties: `setting`
- `diagnostics_opt_in`
  - allowed properties: none
- `diagnostics_opt_out`
  - allowed properties: none
- `product_analytics_opt_in`
  - allowed properties: none
- `product_analytics_opt_out`
  - allowed properties: none

Richer onboarding, review/apply, and session-duration events should be added in
follow-up work only after they have explicit allowlisted property contracts.

## Real-Send Smoke Test

Do not claim end-to-end analytics delivery from unit tests alone. A real
PostHog smoke test requires:

- a build with `VITE_POSTHOG_KEY` set to the dedicated nixmac project key;
- `VITE_NIXMAC_E2E_MODE` disabled;
- `productAnalyticsEnabled` enabled in Settings;
- a product action that emits a known event;
- confirmation that the event appears in the dedicated PostHog project.

If project credentials or dashboard access are unavailable, report that as a
remaining verification gap.
