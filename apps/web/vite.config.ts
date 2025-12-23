import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: {
    port: 3001,
  },
  plugins: [
    tsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    nitro(),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
  // Fix circular dependency issues in SSR bundle
  build: {
    rollupOptions: {
      output: {
        // Avoid mangling exports that cause circular ref issues
        preserveModules: false,
      },
    },
  },
  ssr: {
    // Force these packages to be bundled properly
    noExternal: ["@tanstack/react-router", "@tanstack/react-start"],
  },
});
