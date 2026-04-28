# Tauri WebDriverIO E2E

This folder contains Tauri end-to-end tests using WebDriverIO + [tauri-webdriver](https://github.com/danielraffel/tauri-webdriver).

Current test files live in `e2e-tauri/tests`.

## Prerequisites

1. `tauri-wd` installed and available on `PATH`:
   1. `cargo install tauri-webdriver-automation`
1. Tauri app compiled in debug mode (default binary = `(repo root)/target/debug/nixmac`)

## Adding new WDIO tests

- Per-test WDIO conf: Each new E2E test suite should get its own small WDIO config file under this folder (for example `wdio.discard.conf.mjs` or `wdio.modify.conf.mjs`).

  - Why: WDIO launches the app binary as part of starting a test run; any environment or on-disk setup that the app relies on (for example: writing `settings.json` or creating a temporary `configDir` git repo) must happen before the app binary is launched. The easiest and most reliable way to guarantee that setup runs before the app is started is to perform it in `onPrepare` of a WDIO config.
  - Our pattern: `wdio.conf.base.mjs` exports `createWdioConfig({ specs, setupOptions })`. Per-suite configs call that factory and pass `setupOptions` (e.g. `{ initializeConfigRepo: true }`). This ensures `setupNixmacTestEnvironment` runs in `onPrepare` before the Tauri binary starts.

- How to add a new test suite

  1. Create your spec file under `tests/wdio/`, e.g. `tests/wdio/my-feature.spec.mjs`.

  1. Add a per-suite config in this folder, e.g. `wdio.my-feature.conf.mjs`:

     ```js
     import { createWdioConfig } from './wdio.conf.base.mjs';

     export const config = createWdioConfig({
     specs: ['./tests/wdio/my-feature.spec.mjs'],
     setupOptions: { initializeConfigRepo: true }, // customize per-suite
     });
     ```

  1. Add an npm script in `apps/native/package.json` (optional convenience):

```json
      "test:wdio:my-feature": "wdio run e2e-tauri/wdio.my-feature.conf.mjs"
```

- Environment and secrets
  - If your tests use the vLLM backend, set `VLLM_API_BASE_URL` and `VLLM_API_KEY` in the environment before running the WDIO task (the `setupNixmacTestEnvironment` helper reads those to generate `settings.json`). Example:

```bash
      export VLLM_API_BASE_URL="http://example.com/v1"
      export VLLM_API_KEY="$VLLM_API_KEY"
      bun run test:wdio:my-feature
```

- E2E app-state isolation
  - WDIO tests use an isolated app data directory instead of the user's real `~/Library/Application Support/com.darkmatter.nixmac`.
  - `bun run test:wdio:services` serves the built frontend on `5174` and launches `tauri-wd` with:
    - `NIXMAC_E2E_APP_DATA_DIR=/tmp/nixmac-wdio-app-data` unless overridden
    - `NIXMAC_E2E_BYPASS_SINGLE_INSTANCE=1`
    - `NIXMAC_SKIP_PERMISSIONS=1`
    - `NIXMAC_DISABLE_UPDATER=1`
  - Build the debug binary for E2E before running WDIO:

```bash
      bun run test:wdio:build
```

  - That script builds the frontend and embeds `http://localhost:5174` as the
    Tauri dev URL so WDIO does not collide with other local apps using the
    default Vite port `5173`.
  - If you start services manually, serve `dist/` on the same port and export the
    same environment before launching `tauri-wd`:

```bash
      python3 -m http.server 5174 --bind 127.0.0.1 --directory dist

      export NIXMAC_E2E_APP_DATA_DIR=/tmp/nixmac-wdio-app-data
      export NIXMAC_E2E_BYPASS_SINGLE_INSTANCE=1
      export NIXMAC_SKIP_PERMISSIONS=1
      export NIXMAC_DISABLE_UPDATER=1
      tauri-wd
```

- Test helpers and hooks

  - Use the existing dev-only test hook pattern when you need to drive or observe app state from WDIO: the app exposes `window.__testWidget` in DEV builds (see `src/utils/widget-test-helpers.ts`). Helpers include `setEvolvePrompt()`, `isEvolveProcessing()`, and `getPromptHistory()` — call them via `browser.execute(...)` from your WDIO helpers.
  - Prefer using store-driven helpers (above) over DOM event hacks — they are faster and more reliable for React+Zustand apps running in Tauri webviews (noting that we cannot use React Testing Library in a Tauri app unfortunately).

- data-testid's

  - When adding new interactive elements you plan to target from E2E tests, add a `data-testid` attribute (or an `id`) to the element in the component source so selectors are stable and readable.

## Mocking AI Completion Responses

Instead of pointing tests at a real vLLM endpoint, you can start a lightweight local HTTP server that replays canned OpenAI-compatible responses from JSONL fixture files. The server is started in `onPrepare` (before the app binary launches) and its URL is written into `settings.json` as `vllmApiBaseUrl`, so the app talks to it transparently.

### How it works

- `mockVllm: {}` in `setupOptions` tells `setupNixmacTestEnvironment` to start a mock server on a random free port.
- The server queues responses in order and returns one per `POST /v1/chat/completions` request.
- If the queue runs dry, it returns a `500` with `code: MOCK_RESPONSE_QUEUE_EXHAUSTED` plus a preview of the request body that over-ran it.
- Within a test, call `setMockVllmResponses(...)` to load responses at the start of each `it` block. The server resets its queue and index on every call, so tests are independent.

### Fixture files

Fixtures live under `tests/data/`. Each file is a JSONL file where every line is a valid `CreateChatCompletionResponse` JSON object — exactly what the real vLLM/OpenAI API would return. You can capture real responses (potentially by running nixmac against a real LLM endpoint with `NIXMAC_RECORD_COMPLETIONS` turned on) and drop them in here.

Named presets live in `tests/wdio/helpers/mock-vllm-presets.mjs`:

```js
const MOCK_VLLM_FIXTURE_PRESETS = Object.freeze({
  basicPromptsAddFont: ['add-font.jsonl'],
});
```

Add new presets there as you add new fixture files.

### Suite config

Enable the mock server for a suite by passing `mockVllm: {}` in `setupOptions`. No fixture files need to be specified here — individual tests pick their own responses at runtime:

```js
import { createWdioConfig } from './wdio.conf.base.mjs';

export const config = createWdioConfig({
  specs: ['./tests/wdio/my-feature.spec.mjs'],
  setupOptions: {
    initializeConfigRepo: true,
    mockVllm: {},
  },
});
```

### Inside a test

Load responses at the top of each `it` block before triggering any UI action that will cause the app to call the LLM:

```js
import { setMockVllmResponses } from './helpers/test-env.mjs';
import { getMockVllmFixturePreset } from './helpers/mock-vllm-presets.mjs';

it('does something with the LLM', async () => {
  await setMockVllmResponses({
    responseFiles: getMockVllmFixturePreset('basicPromptsAddFont'),
  });

  // now drive the app...
});
```

You can also pass raw response objects instead of files (but this isn't recommended):

```js
await setMockVllmResponses({ responses: [/* ...objects... */] });
```

### Caveats

Currently, the mocked completion responses are strictly linear and we have no differentiation between "evolve" and "summarize" provider responses. If/when the app does some of these things in parallel, we might have to get smarter in here.

## Scenario Manifest and Reports

Canonical scenario names live in `scenarios/manifest.json`. The current mappings are:

| Scenario | Current WDIO suite | Status |
| --- | --- | --- |
| `auto_evolve_basic_package` | `tests/wdio/basic-prompts.spec.mjs` | rename of existing |
| `settings_provider_change` | `tests/wdio/smoke.spec.mjs` | validated existing |
| `discard_and_restore_state` | `tests/wdio/discard.spec.mjs` | validated existing |
| `manual_evolve_existing_changes` | `tests/wdio/modify.spec.mjs` | validated existing |
| `question_answer_followup` | `tests/wdio/question-answer.spec.mjs` | historical regression coverage |
| `onboarding_existing_repo` | `tests/wdio/onboarding.spec.mjs` | validated existing |

Each WDIO suite writes an `e2e-report.json` under `e2e-tauri/artifacts/<scenario>/`.
The report follows `report.schema.json` and is the local precursor to the PR-gate
comment/report contract: scenario status, runner metadata, phases, failure proof,
and replay commands.

### QA surfaces

The PR gate deliberately uses different surfaces for different jobs:

- **Hosted WDIO (`tauri-wdio`)**: deterministic webview assertions for app state,
  mocked provider behavior, and fast regression coverage. Its proof artifact is a
  webview screenshot/frame timeline, not a real desktop recording.
- **Live provider WDIO**: `live_openrouter_evolve_smoke` is intentionally separate
  from the mocked pack. In GitHub Actions it requires the dedicated
  `NIXMAC_E2E_OPENROUTER_API_KEY` secret and does not fall back to the generic
  `OPENROUTER_API_KEY` from `ops/secrets/secrets.yaml`; this avoids silently
  reusing a stale or unfunded personal key. Before the app build, the workflow
  calls OpenRouter `/auth/key`, performs tiny completions against
  `NIXMAC_E2E_OPENROUTER_MODEL` and `NIXMAC_E2E_OPENROUTER_SUMMARY_MODEL`, and
  checks that the evolve model can return OpenAI-compatible tool calls for a
  simple edit request. The CI default evolve model is `openai/gpt-4.1` because
  the WDIO app path uses the OpenAI-compatible tool-call contract; override it
  with `NIXMAC_E2E_OPENROUTER_MODEL` only after validating the model with this
  preflight. This lane is a live contract test for the OpenAI-compatible
  tool-call path, not coverage for the app's production default evolve model.
  If OpenRouter reports a finite `limit_remaining`, the preflight requires at
  least `NIXMAC_E2E_OPENROUTER_MIN_LIMIT_REMAINING` credits (`1` by default).
  Local runs can still use `OPENROUTER_API_KEY` unless
  `NIXMAC_E2E_REQUIRE_DEDICATED_OPENROUTER_KEY=1` is set. Live provider
  scenario completion JSONL logs are uploaded as a GitHub Actions artifact for
  debugging and are intentionally kept out of the public R2 report bundle.
  Preflight diagnostic JSON still lives in the public report bundle and only
  contains bounded synthetic auth/model/tool-call checks.
- **Full-Mac (`tests/e2e`)**: real macOS desktop proof using Peekaboo and ffmpeg.
  These scenarios validate launch/install/OS integration behavior on the configured
  Mac runner and keep real full-screen recordings.
- **AI QA packet**: the aggregate gate builds `ai-qa/index.html`,
  `ai-qa/ai-qa-packet.json`, and `ai-qa/ai-qa-report.md` from scenario reports, manifest metadata, visual
  timelines, capture limitations, and PR metadata. The packet includes a stable
  verdict schema for an LLM reviewer. It reads `NIXMAC_E2E_AI_QA_API_KEY` or
  `OPENAI_API_KEY` from GitHub secrets or `ops/secrets/secrets.yaml`, and
  defaults to `gpt-5.1` unless `NIXMAC_E2E_AI_QA_MODEL` is set. If the key/model
  is absent the gate publishes the packet and marks AI review unavailable instead
  of pretending it ran. Set `NIXMAC_E2E_AI_QA_REQUIRED=true` to make the workflow
  fail unless the AI reviewer returns a `passed` verdict.

Hosted WDIO used to synthesize MP4s from sparse webview screenshots. That made
reviewers scrub something that looked like video but was actually a frame replay.
The default is now a screenshot proof with attached visual timeline. A legacy
hosted frame-replay MP4 is only generated when `NIXMAC_E2E_WEBVIEW_VIDEO=1`.

### Visual timeline analysis

Report rendering also attaches deterministic screenshot analysis to video proof
entries and hosted WDIO frame-timeline screenshot proof. WDIO scenarios analyze
their original action-proof PNG frames before deleting the raw frame directory;
full-Mac scenarios fall back to sampling the encoded screen recording with
`ffmpeg`. The analyzer keeps the first frame, last frame, and visually distinct
frames above a change threshold, then writes those key screenshots under
`e2e-tauri/artifacts/<scenario>/visual-analysis/`.

The generated HTML report shows a Visual timeline for each analyzed proof:
timestamp, thumbnail, change score, contrast/detail metrics, and conservative
observations such as blank, low-contrast, large visual change, or late-flow
frame. These observations are bug-finding evidence only; scripted assertions
still decide pass/fail.

## Current WDIO config

`apps/native/wdio.conf.mjs` uses:

- WebDriver server port: `4444`
- Specs: configured core app suites in `apps/native/wdio.conf.mjs`; onboarding uses `wdio.onboarding.conf.mjs` because it must start without saved settings.
- Tauri binary: `../../target/debug/nixmac`

Important: relative `binary` paths are resolved by `tauri-wd` using the directory where `tauri-wd` was launched.
Start `tauri-wd` from `apps/native` for this relative path to work as-is.

## Run tests

Use two terminals.

### Terminal A: Start static frontend server and tauri-wd

From `apps/native`:

```bash
bun run test:wdio:services
```

Starts on port 5174 and port 4444 (respectively) by default.

### Terminal B: Run WDIO tests

From `apps/native`:

```bash
bun run test:wdio
```

Or directly:

```bash
npx wdio run wdio.conf.mjs
```

## Stop services

Graceful stop (ports 5174 + 4444):

```bash
for p in 5174 4444; do pid=$(lsof -ti tcp:$p); [ -n "$pid" ] && kill $pid; done
```

Impolite stop:

```bash
for p in 5174 4444; do pid=$(lsof -ti tcp:$p); [ -n "$pid" ] && kill -9 $pid; done
```

## Troubleshooting

### `No such file or directory` for binary

Cause: `tauri-wd` launched from a different working directory than expected.

Fix:

1. Launch `tauri-wd` from `apps/native`, or
1. Use an absolute binary path in `wdio.conf.mjs`.

### `no window when running "window"`

Cause: app startup slower than default timing.

Fix: current config already has retries/timeouts and test helper waits for first window.

### `Node.contains must be an instance of Node`

Cause: stale element during rapid React re-render.

Fix: helper uses selector re-query + click retry instead of brittle `waitForClickable` checks.

## Window visibility & focus (macOS)

Important: for reliable native/webview interaction on macOS the app window should be visible and in the foreground. If the window is minimized, fully occluded, or not focused, webviews and native rendering may be throttled or stop painting which can cause click/read failures in tests.

Recommendation: *Keep the app window un-minimized and focused while running tests locally.*
