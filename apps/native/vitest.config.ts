import path from "node:path";
import react from "@vitejs/plugin-react";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
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
        plugins: [
          storybookTest({
            configDir: path.join(__dirname, ".storybook"),
          }),
        ],
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
