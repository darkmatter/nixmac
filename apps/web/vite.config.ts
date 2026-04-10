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
  // In Nix builds, Nitro's nf3/nft file tracer fails in the sandbox because it
  // tries to resolve symlinks across the build tree. noExternals bundles all
  // JS deps into the server bundle instead, which is the correct approach for
  // a self-contained Nix derivation.
  nitro: {
    noExternals: true,
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
