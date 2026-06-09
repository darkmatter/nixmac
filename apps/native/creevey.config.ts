import path from "node:path";
import type { CreeveyConfig } from "creevey";
import { PlaywrightWebdriver } from "creevey/playwright";

// Creevey is used here in a narrow, baseline-free mode: it captures fresh
// screenshots of the handful of stories whose HTML snapshots failed (selected
// via a global `skip` regex injected through VITE_CREEVEY_SKIP_REGEX in
// .storybook/preview.tsx) so they can be embedded in the PR comment. There are
// no committed reference images, so every captured story "fails" (new image)
// and Creevey writes the actual screenshot into reportDir, which we harvest.
const appRoot = import.meta.dirname;

const config: CreeveyConfig = {
  webdriver: PlaywrightWebdriver,
  useDocker: false,
  storybookUrl: process.env.CREEVEY_STORYBOOK_URL ?? "http://localhost:6006",
  reportDir: path.join(appRoot, "test-results", "creevey", "report"),
  screenDir: path.join(appRoot, "test-results", "creevey", "images"),
  maxRetries: 0,
  testTimeout: 30_000,
  browsers: {
    chromium: {
      browserName: "chromium",
      viewport: { width: 1024, height: 768 },
      playwrightOptions: {
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu-sandbox",
          "--disable-gpu",
          "--no-zygote",
        ],
      },
    },
  },
};

export default config;
