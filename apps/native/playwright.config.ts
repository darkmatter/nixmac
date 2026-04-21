import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright browser tests for the native (web) UI.
 *
 * These run against Vite's dev server (the same one Tauri points at via
 * `tauri.conf.json` -> `build.devUrl`). That lets us exercise the React
 * UI without needing the Tauri shell. Tauri IPC calls are intercepted via
 * `window.__TAURI_INTERNALS__` mocks injected in each spec's beforeEach.
 *
 * Conventions:
 *   - Specs live in `./browser-tests/**\/*.spec.ts`.
 *   - The `webServer` block boots `bun run dev` automatically so
 *     `bun run test:browser` works from a cold start. Reuse it locally to
 *     speed up iteration.
 */
const PORT = Number(process.env.E2E_PORT ?? 5173);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const IS_CI = !!process.env.CI;

export default defineConfig({
  testDir: "./browser-tests",
  testMatch: /.*\.spec\.ts$/,

  // Fail the build on `test.only` left in code in CI.
  forbidOnly: IS_CI,

  // Parallel within a file; Playwright parallelises across files by default.
  fullyParallel: true,

  retries: IS_CI ? 2 : 0,
  workers: IS_CI ? 1 : undefined,

  reporter: IS_CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Uncomment when we want cross-browser coverage. Each browser must
    // be installed first via `bun run test:browser:install` (downloads ~120MB).
    // { name: "webkit",  use: { ...devices["Desktop Safari"] } },
    // { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],

  webServer: {
    command: "bun run dev",
    url: BASE_URL,
    reuseExistingServer: !IS_CI,
    stdout: "ignore",
    stderr: "pipe",
    timeout: 120_000,
  },
});
