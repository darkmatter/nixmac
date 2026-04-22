# End-to-end tests (Playwright)

These specs drive the web UI that Vite serves (the same bundle Tauri loads
in the desktop window). Running them against the browser dev server is
the fast path — no Rust build required.

## Running

```sh
# one-time: install browser binaries (downloads Chromium ~120MB)
bun run test:e2e:install

# run the whole suite headlessly (boots `vite` automatically)
bun run test:e2e

# interactive UI mode — runs a local server you open yourself
bun run test:e2e:ui
# then open the URL it prints (http://127.0.0.1:7777) in any browser

# run in a visible browser window
bun -F native test:e2e:headed

# open the last HTML report
bun -F native test:e2e:report
```

### About UI Mode on macOS

`test:e2e:ui` binds the UI Mode server to `127.0.0.1:7777` and asks you
to open it yourself. This avoids Playwright's default behaviour of
launching a chromeless `Google Chrome for Testing` window via
`--app=data:text/html,`. On macOS that chromeless window:

- has no tabs, no URL bar, no Dock icon of its own, and
- doesn't reliably steal focus,

so it's easy to mistake it for "nothing launched" or "Safari devtools
opened with nothing behind it". Opening UI Mode in your own browser
(Chrome, Safari, Arc, Zen, whatever) sidesteps all of that and gives
you a regular, keyboard-focusable window.

If you prefer the old in-app window behaviour, it's still there as
`bun -F native test:e2e:ui:app`.

### Against a server you already started

If `vite` is already running on `http://localhost:5173`, Playwright will
reuse it (`reuseExistingServer: true` outside CI). To point at a
different origin:

```sh
E2E_BASE_URL=http://localhost:4173 bun run test:e2e
```

## Layout

- `playwright.config.ts` — project config, one Chromium project by default.
- `e2e/*.spec.ts` — test files. Anything matching `*.spec.ts` runs.
- `playwright-report/`, `test-results/` — generated output (gitignored).

## Tauri-specific flows

You can test those with `wdio` with the resources in the [e2e-tauri](../e2e-tauri/) directory.
