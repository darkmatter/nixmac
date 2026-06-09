import path from "node:path";
import react from "@vitejs/plugin-react";
import storybookTest from "@storybook/addon-vitest/vitest-plugin";
import type {} from "@vitest/browser/providers/playwright";
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

const storybookOptimizeDeps = [
  "@radix-ui/react-popover",
  "@radix-ui/react-slot",
  "@react-three/drei",
  "@react-three/fiber",
  "class-variance-authority",
  "clsx",
  "lucide-react",
  "lottie-react",
  "monaco-editor-textmate",
  "monaco-textmate",
  "onigasm",
  "tailwind-merge",
  "three",
] as const;

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: storybookOptimizeDeps,
  },
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
      provider: "istanbul",
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "dist/**",
        "dist-electron/**",
        "public/**",
        "**/*.d.ts",
        "**/*.stories.{ts,tsx}",
        "**/*.test.{ts,tsx}",
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
        resolve: {
          alias: [
            {
              find: "@monaco-editor/react",
              replacement: path.resolve(import.meta.dirname, ".storybook/mocks/monaco-react.tsx"),
            },
            {
              find: "monaco-editor",
              replacement: path.resolve(import.meta.dirname, ".storybook/mocks/monaco-editor.ts"),
            },
          ],
        },
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            provider: "playwright",
            headless: true,
            fileParallelism: false,
            instances: [
              {
                browser: "chromium",
                launch: {
                  args: [
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu-sandbox",
                    "--disable-gpu",
                    "--no-zygote",
                  ],
                },
              },
            ],
          },
          setupFiles: ["./.storybook/vitest.setup.ts"],
        },
      },
    ],
  },
});
