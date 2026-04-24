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
  - Clean-start variant: pass `{ initializeEmptyConfigDir: true }` for onboarding/bootstrap flows where the app should start with an empty (modulo an empty git repo) temporary config directory.

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
  - WDIO vLLM mode is controlled by `NIXMAC_WDIO_VLLM_MODE`:
    - `playback` (default): run against fixture-backed mock server.
    - `real`: bypass mock server and call real vLLM directly.
  - For `real`, set `VLLM_API_BASE_URL` (and `VLLM_API_KEY` if your backend requires auth) before running tests.
  - For `playback`, no real vLLM credentials are required.
  - Example (real mode):

```bash
      export NIXMAC_WDIO_VLLM_MODE="real"
      export VLLM_API_BASE_URL="http://example.com/v1"
      export VLLM_API_KEY="${VLLM_API_KEY}"
      bun run test:wdio:modify
```

- Test helpers and hooks

  - Use the existing dev-only test hook pattern when you need to drive or observe app state from WDIO: the app exposes `window.__testWidget` in DEV builds (see `src/utils/widget-test-helpers.ts`). Helpers include `setEvolvePrompt()`, `isEvolveProcessing()`, and `getPromptHistory()` — call them via `browser.execute(...)` from your WDIO helpers.
  - Prefer using store-driven helpers (above) over DOM event hacks — they are faster and more reliable for React+Zustand apps running in Tauri webviews (noting that we cannot use React Testing Library in a Tauri app unfortunately).
  - New prompt-suite helpers in `tests/wdio/helpers/app-ui.mjs`:
    - `preparePromptTestCase(...)`: reset UI state + load mock responses for one test case.
    - `registerPromptSuiteBeforeEach(...)`: suite-level per-test-case fixture mapping.

- data-testid's

  - When adding new interactive elements you plan to target from E2E tests, add a `data-testid` attribute (or an `id`) to the element in the component source so selectors are stable and readable.

## vLLM Test Modes (Playback / Real)

The suite config for `modify` now supports a mode switch via `NIXMAC_WDIO_VLLM_MODE`:

- `playback`: use fixture responses only.
- `real`: call real vLLM directly (no recording).

The helper lives in `tests/wdio/helpers/vllm-test-mode.mjs` and is wired into `wdio.modify.conf.mjs`.

### Quick start for `modify.spec`

1. Playback mode (default; no real backend required):

```bash
  unset NIXMAC_WDIO_VLLM_MODE
  bun run test:wdio:modify
```

## Onboarding Clean-Start Test

The onboarding suite starts with an empty temporary config directory and verifies:

- `Welcome to nixmac` is shown
- `Create Default Configuration` is shown
- Clicking bootstrap initializes a git repository
- `flake.nix` is created
- The new repo is clean (no outstanding changes)

Run it with:

```bash
  bun run test:wdio:onboarding
```

1. Real mode (no mock, no recording):

```bash
  export NIXMAC_WDIO_VLLM_MODE="real"
  export VLLM_API_BASE_URL="http://your-real-vllm.example/v1"
  export VLLM_API_KEY="${VLLM_API_KEY}"
  bun run test:wdio:modify
```

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
  modifySequentialPrompts: ['add-font-add-another.jsonl'],
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

For single-test suites, load responses at the top of each `it` block before triggering any UI action that will cause the app to call the LLM:

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

### Multi-test case suite pattern (recommended)

Use one `describe` with a fixture map so each test gets clean state and its own mock queue:

```js
import {
  registerPromptSuiteBeforeEach,
  submitPromptMessage,
} from './helpers/app-ui.mjs';
import { getMockVllmFixturePreset } from './helpers/mock-vllm-presets.mjs';

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
- Specs: `./e2e-tauri/tests/wdio/**/*.spec.mjs`
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
