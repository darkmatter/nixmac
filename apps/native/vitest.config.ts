import path from "node:path";
import react from "@vitejs/plugin-react";
import storybookTest from "@storybook/addon-vitest/vitest-plugin";
import { defineConfig } from "vitest/config";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const uiPackageRoot = path.resolve(repoRoot, "packages/ui/src");

// `storybookTest` is async in @storybook/addon-vitest >= 10.3 — must be
// awaited before being passed to Vitest. Skipping the await produces flaky
// "Vitest failed to find the runner" / "Failed to fetch dynamically imported
// module" errors during test runs.
const storybookPlugins = await storybookTest({
  configDir: path.join(import.meta.dirname, ".storybook"),
});

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: "@/components/ui",
        replacement: path.resolve(uiPackageRoot, "components/ui"),
      },
      {
        find: "@nixmac/ui",
        replacement: uiPackageRoot,
      },
      {
        find: "@",
        replacement: path.resolve(import.meta.dirname, "src"),
      },
    ],
  },
  test: {
    coverage: {
      reporter: ["text", "html"],
      provider: "v8",
      reportsDirectory: "./coverage",
      exclude: [
        "dist/**",
        "dist-electron/**",
        "public/**",
        "**/*.d.ts",
        "vite.config.ts",
      ],
    },
    projects: [
      // Unit tests (jsdom)
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./vitest.setup.ts"],
          include: ["src/**/*.test.{ts,tsx}"],
          poolOptions: {
            forks: { singleFork: true },
          },
        },
      },
      // Storybook snapshot & component tests (browser)
      {
        extends: true,
        plugins: storybookPlugins,
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            provider: "playwright",
            headless: true,
            instances: [{ browser: "chromium" }],
          },
          setupFiles: ["./.storybook/vitest.setup.ts"],
        },
      },
    ],
  },
});
