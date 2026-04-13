import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
    // PNPM requires following symlinks for nested deps resolution (e.g. react-style-singleton).
    // Keeping this false fixes "Failed to resolve import" for transitive deps.
    preserveSymlinks: false,
  },
  plugins: [
    react({
      babel: {
        // plugins: [['babel-plugin-react-compiler']],
      },
    }),
  ],
  server: {
    watch: {
      // Critical for Nix: don't follow symlinks
      followSymlinks: false,
      ignored: ["**/src-tauri/**", "**/node_modules/**", "**/.direnv/**", "**/.devenv/**"],
      // Use polling as fallback for Nix
      // usePolling: true,
      // interval: 1000,
    },
    fs: {
      // Allow serving files from Nix store
      allow: ["..", "".concat(process.env.HOME, "/.nix-profile"), "/nix/store"],
    },
  },
  optimizeDeps: {
    // Prebundle these to avoid resolver edge-cases with PNPM symlinks
    include: [
      "react",
      "react-dom",
      "react-remove-scroll",
      "react-remove-scroll-bar",
      "react-style-singleton",
      "@radix-ui/react-select",
      "@radix-ui/number",
      "@radix-ui/react-compose-refs",
    ],
    // Don't optimize packages from Nix store
    exclude: [],
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // Use `esnext` to avoid esbuild attempting unsupported destructuring transforms
    // for the configured targets. Vite/esbuild will then preserve modern syntax
    // that Tauri supports.
    target: "esnext",
    minify: process.env.TAURI_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_DEBUG,
    // Avoid issues with Nix symlinks in build
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        "preview-indicator": path.resolve(__dirname, "preview-indicator.html"),
        "peek-icon": path.resolve(__dirname, "src/peek-icon.html"),
      },
    },
  },
});
