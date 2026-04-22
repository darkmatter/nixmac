# Tauri WebDriverIO E2E

This folder contains Tauri end-to-end tests using WebDriverIO + [tauri-webdriver](https://github.com/danielraffel/tauri-webdriver).

Current test files live in `e2e-tauri/tests`.

## Prerequisites

1. `tauri-wd` installed and available on `PATH`:
   1. `cargo install tauri-webdriver-automation`
1. Tauri app compiled in debug mode (default binary = `(repo root)/target/debug/nixmac`)

## Current WDIO config

`apps/native/wdio.conf.mjs` uses:

- WebDriver server port: `4444`
- Specs: `./e2e-tauri/tests/wdio/**/*.spec.mjs`
- Tauri binary: `../../target/debug/nixmac`

Important: relative `binary` paths are resolved by `tauri-wd` using the directory where `tauri-wd` was launched.
Start `tauri-wd` from `apps/native` for this relative path to work as-is.

## Run tests

Use three terminals.

### Terminal A: Start frontend dev server (Vite)

From `apps/native`:

```bash
bun run dev
```

Starts on port 5173 by default.

### Terminal B: Start tauri-wd

From `apps/native`:

```bash
tauri-wd
```

Starts on port 4444 by default.

### Terminal C: Run WDIO tests

From `apps/native`:

```bash
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
