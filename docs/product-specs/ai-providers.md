# AI Providers And Model Selection

This doc covers the provider/model surface used by onboarding, Settings,
summaries, evolutions, CLI mode, telemetry, and tests.

## Current Provider Contract

Provider IDs are data contracts. Do not rename them casually, and do not add UI
labels that imply a provider is configured when the backing credential or local
runtime is missing.

Provider availability is time-sensitive. A stable visible model alias such as
`auto` can route to different providers over time. When changing provider or
model behavior, verify the actual runtime/provider at the time of the change and
do not rely on stale Slack claims.

Known provider IDs:

- `nixmac` - hosted nixmac inference. Requires desktop app context and a device
  API key.
- `openrouter` - OpenRouter-compatible hosted API. Requires an OpenRouter key.
- `openai` - direct OpenAI provider. Requires an OpenAI key.
- `openai_compatible` - custom OpenAI-compatible base URL. Requires base URL
  and model.
- `ollama` - local Ollama endpoint. Requires a model; uses the configured base
  URL or the local default.
- `claude`, `codex`, `opencode` - CLI-backed providers. They depend on the
  corresponding CLI being installed and visible in PATH.

Frontend validation lives in
`apps/native/src/lib/providers/ai-provider-validation.ts`. Backend provider
creation lives in `apps/native/src-tauri/src/ai/providers/mod.rs`. Keep those
surfaces aligned.

## Defaulting Rules

- A missing OpenAI-compatible provider resolves to `openai` only when an OpenAI
  key exists and no OpenRouter key exists. Otherwise it defaults to
  `openrouter`.
- Legacy `openai` preferences may resolve to `openrouter` when only OpenRouter
  credentials exist or when the selected model is an OpenRouter slug.
- OpenRouter defaults should preserve provider/model slugs such as
  `openai/gpt-4o-mini`. Direct OpenAI defaults should strip `openai/` prefixes
  before calling OpenAI.
- OpenAI-compatible and Ollama selections must not show empty model
  placeholders as if they are valid choices.
- CLI-backed providers such as `claude`, `codex`, and `opencode` may have valid
  empty model defaults because the CLI can choose its own configured default.
  Readiness checks should be provider-aware and must not reduce to
  `Boolean(provider) && Boolean(model)` for every provider.

## UX Guardrails

- Onboarding AI setup must match Settings provider choices. Do not invent a
  separate onboarding-only provider taxonomy.
- Provider errors should be actionable: missing key, missing model, missing
  base URL, CLI missing from PATH, hosted sign-in required, provider rate/billing
  issue, or upstream provider failure.
- Billing/rate/provider availability failures should not be reported as app
  logic failures. Preserve enough error shape to classify the failure without
  logging secrets or raw prompts.
- Never log raw API keys, generated prompts, or full provider responses in
  production paths.
- Telemetry can include provider/model class and usage counters only when the
  user-facing diagnostics setting allows it.

## Test Expectations

Provider changes should include targeted tests for:

- frontend validation in `ai-provider-validation.test.ts`;
- backend provider resolution in `apps/native/src-tauri/src/ai/providers/mod.rs`;
- e2e OpenAI-compatible fixtures under `apps/native/e2e-tauri/tests/wdio`;
- onboarding/Settings story states when UI copy or model pickers change.

For local app verification, include at least one path that proves provider/model
selection is visible and does not block unrelated onboarding steps.
