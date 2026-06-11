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

PostHog requires an actor key to calculate funnels. nixmac uses an anonymous
per-launch session ID as `distinct_id`. The value is generated in memory, is
never persisted, and is not derived from the machine, user, config path, host
name, account, or API credentials. This enables within-session funnels while
preserving the no persistent user/machine identity privacy boundary. Funnels
that span app restarts should be treated as lower bound measurements unless a
future privacy decision explicitly introduces a persisted anonymous install ID.

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
  - allowed properties: `provider`, `has_custom_model`, `source`
  - allowed values: `source = prompt`
- `evolve_completed`
  - allowed properties: `step`, `outcome`
  - allowed values: `outcome = changes | conversational`
- `evolve_failed`
  - allowed properties: `stage`
  - allowed values: `stage = agent | apply | build`
- `error_occurred`
  - allowed properties: `category`, `surface`
  - allowed values:
    - `category = agent | authorization_denied | build_error | evaluation_error | full_disk_access | generic_error | infinite_recursion | user_cancelled`
    - `surface = gui | cli`
- `rollback_performed`
  - allowed properties: `source`
  - allowed values: `source = changes`
- `apply_started`
  - allowed properties: `source`
  - allowed values: `source = changes | history | manual_confirm`
- `apply_completed`
  - allowed properties: `source`, `result`
  - allowed values: `source = changes | history | manual_confirm`,
    `result = success | failure`
- `review_accepted`
  - allowed properties: `changed_file_count`, `surface`
  - allowed values: `surface = gui | cli`
- `review_rejected`
  - allowed properties: `changed_file_count`, `surface`
  - allowed values: `surface = gui | cli`
- `history_restore_started`
  - allowed properties: `changed_file_count`, `surface`
  - allowed values: `surface = gui | cli`
- `history_restore_completed`
  - allowed properties: `changed_file_count`, `surface`
  - allowed values: `surface = gui | cli`
- `history_restore_failed`
  - allowed properties: `changed_file_count`, `category`, `surface`
  - allowed values:
    - `category = agent | authorization_denied | build_error | evaluation_error | full_disk_access | generic_error | infinite_recursion | user_cancelled`
    - `surface = gui | cli`
- `onboarding_started`
  - allowed properties: `surface`
  - allowed values: `surface = gui | cli`
- `onboarding_step_completed`
  - allowed properties: `step`, `source`
  - allowed values:
    - `step = config_directory | host_configuration`
    - `source = github_import | manual | picker | zip_import`
- `onboarding_completed`
  - allowed properties: `step`
  - allowed values: `step = host_configuration`
- `nix_setup_started`
  - allowed properties: `target`, `trigger`
  - allowed values: `target = nix | nix_darwin`,
    `trigger = automatic | user`
- `nix_setup_completed`
  - allowed properties: `target`
  - allowed values: `target = nix | nix_darwin`
- `nix_setup_failed`
  - allowed properties: `target`
  - allowed values: `target = nix | nix_darwin`
- `settings_changed`
  - allowed properties: `setting`, `surface`
  - allowed values:
    - `setting = evolve_provider | evolve_model | summary_provider | summary_model`
    - `surface = gui | cli`
- `settings_opened`
  - allowed properties: `surface`
  - allowed values: `surface = gui | cli`
- `diagnostics_opt_in`
  - allowed properties: none
- `diagnostics_opt_out`
  - allowed properties: none
- `product_analytics_opt_in`
  - allowed properties: none
- `product_analytics_opt_out`
  - allowed properties: none

Website acquisition events and starter-access events are not native app events
yet. Track them under ENG-534/ENG-544 once those surfaces have concrete event
boundaries and the same explicit property contracts.

True process-exit `session_ended`/`app_closed` events are intentionally not
emitted from the WebView. The native app hides the main window instead of
closing it, so browser unload hooks would produce false telemetry. Implement
that boundary from Rust process-exit/session state work before adding those
events to this contract. `onboarding_abandoned` is also intentionally deferred:
derive it in PostHog from `onboarding_started` without `onboarding_completed`,
or add it later from a durable native session boundary.

## Canonical PostHog Funnels

Build dashboards from these event sequences. Filter all insights by
`environment` and `release`.

- Native activation:
  `app_launched` -> `app_ready` -> `onboarding_started` ->
  `onboarding_step_completed`
  where `step = config_directory` -> `onboarding_step_completed`
  where `step = host_configuration` -> `onboarding_completed` ->
  `evolve_started` -> `apply_completed` where `result = success`.
- AI value loop:
  `evolve_started` -> `evolve_completed` where `outcome = changes` ->
  `review_accepted` -> `apply_started` -> `apply_completed`
  where `result = success`.
- Conversational follow-up loop:
  `evolve_started` -> `evolve_completed` where `outcome = conversational`.
- Nix setup:
  `nix_setup_started` -> `nix_setup_completed`, with a sibling trend for
  `nix_setup_failed` by `target`.
- Recovery health:
  `apply_completed` where `result = success` -> `rollback_performed`,
  plus `history_restore_started` -> `history_restore_completed` /
  `history_restore_failed`.
- Consent health:
  trend `product_analytics_opt_out` divided by `app_launched` for the same
  time window. Do not model opt-out users as a segment after opt-out; once
  product analytics is disabled, future events intentionally stop.

Expected launch dashboard cards:

- app launches by release/environment;
- activation completion rate;
- first evolve-to-successful-apply conversion;
- evolve failure rate by stage;
- apply success rate by source;
- rollback rate after successful apply;
- Nix setup completion/failure by target;
- product analytics opt-out rate.

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
