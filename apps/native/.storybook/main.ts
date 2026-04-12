import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

const storybookDir = fileURLToPath(new URL(".", import.meta.url));

const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: [
    "@storybook/addon-essentials",
    "@storybook/addon-a11y",
    "@storybook/addon-onboarding",
    "@storybook/addon-vitest",
  ],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  viteFinal: async (config) => {
    const merged = mergeConfig(config, {
      resolve: {
        alias: {
          "@/tauri-api": path.resolve(storybookDir, "mocks/tauri-api.ts"),
          "@tauri-apps/api/core": path.resolve(storybookDir, "mocks/tauri-core.ts"),
          "@tauri-apps/api/event": path.resolve(storybookDir, "mocks/tauri-event.ts"),
          "@tauri-apps/plugin-shell": path.resolve(storybookDir, "mocks/tauri-plugin-shell.ts"),
          "tauri-plugin-macos-permissions-api": path.resolve(
            storybookDir,
            "mocks/tauri-permissions.ts",
          ),
        },
      },
    });
    merged.build ??= {};
    merged.build.target = "esnext";
    return merged;
  },
};

export default config;
