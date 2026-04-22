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

- Test helpers and hooks

  - Use the existing dev-only test hook pattern when you need to drive or observe app state from WDIO: the app exposes `window.__testWidget` in DEV builds (see `src/utils/widget-test-helpers.ts`). Helpers include `setEvolvePrompt()`, `isEvolveProcessing()`, and `getPromptHistory()` — call them via `browser.execute(...)` from your WDIO helpers.
  - Prefer using store-driven helpers (above) over DOM event hacks — they are faster and more reliable for React+Zustand apps running in Tauri webviews (noting that we cannot use React Testing Library in a Tauri app unfortunately).

- data-testid's

  - When adding new interactive elements you plan to target from E2E tests, add a `data-testid` attribute (or an `id`) to the element in the component source so selectors are stable and readable.

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
