import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeConfig } from "vite";
import { nixmacBuildDefines } from "../nixmac-profile";

const storybookDir = fileURLToPath(new URL(".", import.meta.url));
const appRoot = path.resolve(storybookDir, "..");
const repoRoot = path.resolve(appRoot, "../..");
const uiPackageRoot = path.resolve(repoRoot, "packages/ui/src");
const statePackageRoot = path.resolve(repoRoot, "packages/state/src");

const config: StorybookConfig = {
  stories: [
    "../src/**/*.mdx",
    "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../../../packages/ui/src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
  ],
  addons: [
    getAbsolutePath("@storybook/addon-a11y"),
    getAbsolutePath("@storybook/addon-onboarding"),
    getAbsolutePath("@storybook/addon-vitest"),
    getAbsolutePath("@storybook/addon-docs"),
    // getAbsolutePath("@vueless/storybook-dark-mode")
  ],
  framework: {
    name: getAbsolutePath("@storybook/react-vite"),
    options: {},
  },
  viteFinal: async (config) => {
    process.env.NIX_INSTALLED_OVERRIDE = "true";
    const merged = mergeConfig(config, {
      define: nixmacBuildDefines(appRoot),
      plugins: [tailwindcss()],
      resolve: {
        alias: {
          "@": path.resolve(appRoot, "src"),
          "#storybook/preview": path.resolve(storybookDir, "preview.tsx"),
          "@/ipc/api": path.resolve(storybookDir, "mocks/ipc-api.ts"),
          "@/components/ui": path.resolve(uiPackageRoot, "components/ui"),
          "@nixmac/ui": uiPackageRoot,
          "@nixmac/state": statePackageRoot,
          "@nixmac/native/ipc/types": path.resolve(appRoot, "src/ipc/types.ts"),
          "@nixmac/native/types/feedback": path.resolve(appRoot, "src/types/feedback.ts"),
          "@nixmac/native/types/rebuild": path.resolve(appRoot, "src/types/rebuild.ts"),
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
    merged.build ??= {};
    merged.build.target = "esnext";
    // Force Vite HMR to use localhost instead of the auto-detected link-local
    // address (169.254.x.x). Without this, visiting localhost:6006 causes 404s
    // because Vite's HMR client tries to reach the link-local address.
    merged.server ??= {};
    merged.server.host = "localhost";
    merged.server.hmr ??= {};
    merged.server.hmr.host = "localhost";
    return merged;
  },
};

export default config;

function getAbsolutePath(value: string): any {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}
