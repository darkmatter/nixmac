# Tauri WebDriverIO E2E

This folder contains Tauri end-to-end tests using WebDriverIO + [tauri-webdriver](https://github.com/danielraffel/tauri-webdriver).

WDIO test sources live under `e2e-tauri/tests/wdio` as TypeScript (`*.ts`) and compile to `apps/native/dist-e2e/tests/wdio` (`*.js`).

## Test Execution Model

### Process Isolation for State Management

Each WDIO test suite runs in its **own isolated process** with its own `onPrepare` and `onComplete` lifecycle. This is crucial because:

- WDIO launches the app binary and can only run a single app instance per process
- Tests require specific on-disk state before the app launches (config repo, settings file, etc.)
- Different suites have **mutually exclusive** setup requirements:
  - **Prompt suites** (smoke, basic-prompts, discard, modify): need `initializeConfigRepo: true` (populated config git repo)
  - **Onboarding suite**: needs `initializeEmptyConfigDir: true` (empty config directory for bootstrap)

### Running the Tests

- **`npm run test:wdio`** – runs all suites sequentially in separate processes:

  1. `test:wdio:smoke` → fresh config repo → cleanup
  1. `test:wdio:basic-prompts` → fresh config repo → cleanup
  1. `test:wdio:discard` → fresh config repo → cleanup
  1. `test:wdio:modify` → fresh config repo → cleanup
  1. `test:wdio:onboarding` → empty config dir → cleanup

  **Output format:**

  ```
  🧪 Running all WDIO test suites...

  ⏳ SMOKE... ✅
  ⏳ BASIC-PROMPTS... ✅
  ⏳ DISCARD... ✅
  ⏳ MODIFY... ✅
  ⏳ ONBOARDING... ✅

  ==================================================
  📊 Test Results Summary
  ==================================================
    ✅ SMOKE
    ✅ BASIC-PROMPTS
    ✅ DISCARD
    ✅ MODIFY
    ✅ ONBOARDING
  ==================================================

  5/5 suites passed
  ```

  The aggregate reporting script ([scripts/run-wdio-tests.mjs](../scripts/run-wdio-tests.mjs)) runs all suites and collects their results, printing a unified summary at the end. This is useful for CI pipelines that need to see `X/Y suites passed` at a glance.

- **`npm run test:wdio:smoke`** – runs just smoke tests

- **`npm run test:wdio:basic-prompts`** – runs just basic-prompts tests

- (etc. for discard, modify, onboarding)

Each invocation is completely isolated: modifications made by one suite (e.g., basic-prompts adding fonts.nix) do not leak to subsequent suites.

## Test Orchestration

### Aggregate Reporting for CI

The test runner uses a wrapper script ([scripts/run-wdio-tests.mjs](../scripts/run-wdio-tests.mjs)) to:

1. **Run each suite in sequence** in its own isolated WDIO process
1. **Collect results** from each suite (pass/fail)
1. **Print a unified summary** showing `X/5 suites passed`
1. **Exit with status 1** if any suite fails (useful for CI pipeline gates)

This design gives you the best of both worlds:

- **Process isolation**: Each suite gets a clean environment (prevents state leakage)
- **Aggregate visibility**: CI systems see a single `5/5 passed` or `4/5 passed` result
- **Independent execution**: Individual `npm run test:wdio:smoke` commands still work for quick local testing

The script outputs clear pass/fail status for each suite in real-time, making it easy to spot which suite failed during a CI run without scrolling through all the test output.

## Prerequisites

1. `tauri-wd` installed and available on `PATH`:
   1. `cargo install tauri-webdriver-automation`
1. Tauri app compiled in debug mode (default binary = `(repo root)/target/debug/nixmac`)

## Adding new WDIO tests

### Why Each Suite Gets Its Own Config

WDIO launches the app binary as part of starting a test run. Since each process can only run a single app instance, any environment or on-disk setup that the app relies on must happen **before the app binary is launched**. This setup happens in the `onPrepare` hook of the WDIO config, which runs once per WDIO process invocation.

By giving each suite its own config file (and thus its own process), we ensure:

- ✅ Setup code (`setupNixmacTestEnvironment`) runs before the app launches
- ✅ State is isolated: modifications made during one suite don't leak to others
- ✅ Each suite can specify its own setup requirements (`initializeConfigRepo` vs. `initializeEmptyConfigDir`)
- ✅ Cleanup (`teardownNixmacTestEnvironment`) runs after all tests in that suite complete

### How to Add a New Test Suite

1. Create your spec file under `tests/wdio/`, e.g. `tests/wdio/my-feature.spec.ts` (TypeScript, not JavaScript).

1. Add a per-suite config in this folder, e.g. `wdio.my-feature.conf.mjs`:

   ```js
   import { createWdioConfig } from './wdio.conf.base.mjs';

   export const config = createWdioConfig({
     specs: ['../dist-e2e/tests/wdio/my-feature.spec.js'],
     setupOptions: { initializeConfigRepo: true }, // customize per-suite
   });
   ```

   Choose `setupOptions` based on what your suite needs:

   - `{ initializeConfigRepo: true }` – for tests that assume a populated nix config repo exists
   - `{ initializeEmptyConfigDir: true }` – for onboarding/bootstrap flows that start with an empty config directory
   - Both options set up `mockVllm: {}` automatically (controllable via `NIXMAC_WDIO_VLLM_MODE`)

1. Add an npm script in `apps/native/package.json`:

   ```json
   "test:wdio:my-feature": "npm run build:e2e && wdio run e2e-tauri/wdio.my-feature.conf.mjs"
   ```

1. (Optional) If you want your suite to run as part of `npm run test:wdio`, add it to the aggregation script ([scripts/run-wdio-tests.mjs](../scripts/run-wdio-tests.mjs)) in the `suites` array:

   ```js
   const suites = [
     'test:wdio:smoke',
     'test:wdio:basic-prompts',
     'test:wdio:discard',
     'test:wdio:modify',
     'test:wdio:my-feature',  // ← add your new suite here
     'test:wdio:onboarding',
   ];
   ```

## Environment Variables and Configuration

### vLLM Mode (Playback vs. Real)

Control whether tests use fixture responses or call a real vLLM backend via `NIXMAC_WDIO_VLLM_MODE`:

- `playback` (default) – run against fixture-backed mock HTTP server (no real backend needed)
- `real` – bypass mock server and call a real vLLM endpoint directly

For `playback` mode, no credentials are required. For `real` mode, set:

- `VLLM_API_BASE_URL` – base URL of your real vLLM instance (e.g., `http://localhost:8000/v1`)
- `VLLM_API_KEY` (optional) – API key if your backend requires authentication

Example running a single suite in real mode:

```bash
export NIXMAC_WDIO_VLLM_MODE="real"
export VLLM_API_BASE_URL="http://localhost:8000/v1"
npm run test:wdio:modify
```

### Fixture Data Directory Override

By default, compiled test helpers look for fixture files at `e2e-tauri/tests/data/` (resolved from the compiled output directory). If needed, you can override this:

```bash
export NIXMAC_WDIO_TEST_DATA_DIR="/path/to/custom/fixtures"
npm run test:wdio:smoke
```

## Test Helpers and Hooks

### App State Interaction

Use the dev-only test hook pattern to drive or observe app state from WDIO. The app exposes `window.__testWidget` in DEV builds (see `src/utils/widget-test-helpers.ts`). Helpers include:

- `setEvolvePrompt()` – set the evolve input field
- `isEvolveProcessing()` – check if evolution is in progress
- `getPromptHistory()` – retrieve the list of prior prompts

Call them via `browser.execute(...)` from your WDIO helpers:

```js
const isProcessing = await browser.execute(() => window.__testWidget?.isEvolveProcessing?.());
```

Prefer store-driven helpers over DOM event hacks — they are faster and more reliable for React+Zustand apps running in Tauri webviews (React Testing Library is not available in Tauri apps).

### Prompt Suite Helpers

Located in `tests/wdio/helpers/app-ui.ts`:

- `preparePromptTestCase(...)` – reset UI state and load mock responses for one test
- `registerPromptSuiteBeforeEach(...)` – per-test-case fixture mapping for suites with multiple tests

### Stable Selectors

When adding new interactive elements you plan to target from E2E tests, add a `data-testid` attribute to the component:

```tsx
<button data-testid="my-action-button">Do Something</button>
```

Then target it from WDIO:

```js
await $(('[data-testid="my-action-button"]')).click();
```

This keeps selectors stable and readable as component markup changes.

## Mocking AI Completion Responses

Instead of pointing tests at a real vLLM endpoint, you can start a lightweight local HTTP server that replays canned OpenAI-compatible responses from JSONL fixture files. The server is started in `onPrepare` (before the app binary launches) and its URL is written into `settings.json` as `vllmApiBaseUrl`, so the app talks to it transparently.

### How it works

- `mockVllm: {}` in `setupOptions` tells `setupNixmacTestEnvironment` to start a mock server on a random free port.
- The server queues responses in order and returns one per `POST /v1/chat/completions` request.
- If the queue runs dry, it returns a `500` with `code: MOCK_RESPONSE_QUEUE_EXHAUSTED` plus a preview of the request body that over-ran it.
- Within a test, call `setMockVllmResponses(...)` to load responses at the start of each `it` block. The server resets its queue and index on every call, so tests are independent.

### Fixture files

Fixtures live under `tests/data/`. Each file is a JSONL file where every line is a valid `CreateChatCompletionResponse` JSON object — exactly what the real vLLM/OpenAI API would return. You can capture real responses (potentially by running nixmac against a real LLM endpoint with `NIXMAC_RECORD_COMPLETIONS` turned on) and drop them in here.

Named presets live in `tests/wdio/helpers/mock-vllm-presets.ts`:

```js
const MOCK_VLLM_FIXTURE_PRESETS = Object.freeze({
  basicPromptsAddFont: ['add-font.jsonl'],
  modifySequentialPrompts: ['add-font-add-another.jsonl'],
});
```

Add new presets there as you add new fixture files.

### Suite config

Enable the mock server for a suite by passing `mockVllm: {}` in `setupOptions`. No fixture files need to be specified here — individual tests pick their own responses at runtime:

```js
import { createWdioConfig } from './wdio.conf.base.mjs';

export const config = createWdioConfig({
  specs: ['../dist-e2e/tests/wdio/my-feature.spec.js'],
  setupOptions: {
    initializeConfigRepo: true,
    mockVllm: {},
  },
});
```

### Inside a test

For single-test suites, load responses at the top of each `it` block before triggering any UI action that will cause the app to call the LLM:

```js
import { setMockVllmResponses } from './helpers/test-env.js';
import { getMockVllmFixturePreset } from './helpers/mock-vllm-presets.js';

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

### Multi-test case suite pattern (recommended)

Use one `describe` with a fixture map so each test gets clean state and its own mock queue:

```js
import {
  registerPromptSuiteBeforeEach,
  submitPromptMessage,
} from './helpers/app-ui.js';
import { getMockVllmFixturePreset } from './helpers/mock-vllm-presets.js';

describe('my prompt suite', () => {
  registerPromptSuiteBeforeEach({
    fixtureByTestTitle: {
      'test A': getMockVllmFixturePreset('basicPromptsAddFont'),
      'test B': getMockVllmFixturePreset('basicPromptsConfigureScreenshots'),
    },
  });

  it('test A', async () => {
    await submitPromptMessage('...');
  });

  it('test B', async () => {
    await submitPromptMessage('...');
  });
});
```

### Caveats

Currently, the mocked completion responses are strictly linear and we have no differentiation between "evolve" and "summarize" provider responses. If/when the app does some of these things in parallel, we might have to get smarter in here.

## Current WDIO config

`apps/native/wdio.conf.mjs` uses:

- WebDriver server port: `4444`
- Specs: `../dist-e2e/tests/wdio/**/*.spec.js`
- Tauri binary: `../../target/debug/nixmac`

Important: relative `binary` paths are resolved by `tauri-wd` using the directory where `tauri-wd` was launched.
Start `tauri-wd` from `apps/native` for this relative path to work as-is.

## Run tests

Use two terminals.

### Terminal A: Start frontend dev server (Vite) and tauri-wd

From `apps/native`:

```bash
bun run test:wdio:services
```

Starts on port 5173 and port 4444 (respectively) by default.

### Terminal B: Run WDIO tests

From `apps/native`:

```bash
export VLLM_API_BASE_URL=http://example.com/v1
export VLLM_API_KEY=sk_blahblahblah
bun run test:wdio
```

`test:wdio` and all suite-specific WDIO scripts run `build:e2e` first, so TypeScript sources are compiled before WDIO starts.

Or directly:

```bash
npx wdio run wdio.conf.mjs
```

## Stop services

Graceful stop (ports 5173 + 4444):

```bash
for p in 5173 4444; do pid=$(lsof -ti tcp:$p); [ -n "$pid" ] && kill $pid; done
```

Impolite stop:

```bash
for p in 5173 4444; do pid=$(lsof -ti tcp:$p); [ -n "$pid" ] && kill -9 $pid; done
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
