import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

const storybookDir = fileURLToPath(new URL(".", import.meta.url));
const appRoot = path.resolve(storybookDir, "..");
const repoRoot = path.resolve(appRoot, "../..");
const uiPackageRoot = path.resolve(repoRoot, "packages/ui/src");

function withoutMonacoEditorPlugin(plugins: unknown): unknown {
  if (!Array.isArray(plugins)) return plugins;

  return plugins.flatMap((plugin) => {
    if (Array.isArray(plugin)) {
      return withoutMonacoEditorPlugin(plugin) as unknown[];
    }

    if (
      plugin &&
      typeof plugin === "object" &&
      "name" in plugin &&
      /monaco-editor|moncao-editor/.test(
        String((plugin as { name?: unknown }).name),
      )
    ) {
      return [];
    }

    return [plugin];
  });
}

const config: StorybookConfig = {
  stories: [
    "../src/**/*.mdx",
    "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../../../packages/ui/src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
  ],
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
          "@": path.resolve(appRoot, "src"),
          "#storybook/preview": path.resolve(storybookDir, "preview.tsx"),
          "@/tauri-api": path.resolve(storybookDir, "mocks/tauri-api.ts"),
          "@/components/ui": path.resolve(uiPackageRoot, "components/ui"),
          "@nixmac/ui": uiPackageRoot,
          "@tauri-apps/api/core": path.resolve(storybookDir, "mocks/tauri-core.ts"),
          "@tauri-apps/api/app": path.resolve(storybookDir, "mocks/tauri-app.ts"),
          "@tauri-apps/api/event": path.resolve(storybookDir, "mocks/tauri-event.ts"),
          "@tauri-apps/plugin-shell": path.resolve(storybookDir, "mocks/tauri-plugin-shell.ts"),
          "tauri-plugin-macos-permissions-api": path.resolve(
            storybookDir,
            "mocks/tauri-permissions.ts",
          ),
        },
      },
    });
    // merged.plugins = withoutMonacoEditorPlugin(merged.plugins) as typeof merged.plugins;
    merged.build ??= {};
    merged.build.target = "esnext";
    return merged;
  },
  env: (config) => ({
    ...config,
    NIX_INSTALLED_OVERRIDE: "true",
  }),
};

export default config;
