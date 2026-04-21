# Browser tests (Playwright)

These specs drive the web UI that Vite serves (the same bundle Tauri loads
in the desktop window). They test frontend behaviour in isolation — Tauri IPC
calls are intercepted by mocks so no Rust build is required.

Note: these are not full end-to-end tests. The Rust backend, AI loop, and
build system are not exercised here. Native macOS flows (install, permission
dialogs) are handled by a separate peekaboo-based suite.

## Running

```sh
# one-time: install browser binaries (downloads Chromium ~120MB)
bun run test:browser:install

# run the whole suite headlessly (boots `vite` automatically)
bun run test:browser

# interactive UI mode — runs a local server you open yourself
bun run test:browser:ui
# then open the URL it prints (http://127.0.0.1:7777) in any browser

# run in a visible browser window
bun -F native test:browser:headed

# open the last HTML report
bun -F native test:browser:report
```

### About UI Mode on macOS

`test:browser:ui` binds the UI Mode server to `127.0.0.1:7777` and asks you
to open it yourself. This avoids Playwright's default behaviour of
launching a chromeless `Google Chrome for Testing` window via
`--app=data:text/html,`. On macOS that chromeless window:

- has no tabs, no URL bar, no Dock icon of its own, and
- doesn't reliably steal focus,

so it's easy to mistake it for "nothing launched". Opening UI Mode in your
own browser (Chrome, Safari, Arc, etc.) sidesteps all of that.

If you prefer the old in-app window behaviour, it's still there as
`bun -F native test:browser:ui:app`.

### Against a server you already started

If `vite` is already running on `http://localhost:5173`, Playwright will
reuse it (`reuseExistingServer: true` outside CI). To point at a
different origin:

```sh
E2E_BASE_URL=http://localhost:4173 bun run test:browser
```

## Layout

- `../playwright.config.ts` — project config, one Chromium project by default.
- `*.spec.ts` — test files. Anything matching `*.spec.ts` runs.
- `helpers/mock-tauri.ts` — shared Tauri IPC mock injected per test.
- `../playwright-report/`, `../test-results/` — generated output (gitignored).

## How mocking works

Tauri's `invoke()` internally reads `window.__TAURI_INTERNALS__`. Each spec's
`beforeEach` calls `injectTauriMocks(page)` which sets that object before the
page loads, intercepting all backend calls. Override specific commands by
passing a config to `injectTauriMocks`.
