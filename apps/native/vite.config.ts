import path from "node:path";
import react from "@vitejs/plugin-react";
import monacoEditorPlugin from "vite-plugin-monaco-editor";
import { defineConfig } from "vite";

// Repo root (two levels up from apps/native). Needed so Vite's dev server
// is allowed to serve files from the real paths of symlinked deps under
// `<repo>/node_modules/.bun/...` (bun's hoisted store). Without this,
// monaco-editor's CSS files — which are imported from the real
// `node_modules/.bun/monaco-editor@X/...` path once `preserveSymlinks`
// is false — return 403 from Vite's fs guard.
const repoRoot = path.resolve(__dirname, "../..");

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
    (monacoEditorPlugin as unknown as { default: typeof monacoEditorPlugin })
      .default({}),
  ],
  server: {
    watch: {
      // Critical for Nix: don't follow symlinks
      followSymlinks: false,
      ignored: [
        "**/src-tauri/**",
        "**/node_modules/**",
        "**/.direnv/**",
        "**/.devenv/**",
      ],
      // Use polling as fallback for Nix
      // usePolling: true,
      // interval: 1000,
    },
    fs: {
      // Allow serving files from the repo root (so bun's hoisted
      // `.bun/<pkg>@<ver>/...` real paths resolve), plus Nix profile & store.
      allow: [repoRoot, `${process.env.HOME}/.nix-profile`, "/nix/store"],
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
        "rebuild-overlay": path.resolve(__dirname, "rebuild-overlay.html"),
        "peek-icon": path.resolve(__dirname, "src/peek-icon.html"),
      },
    },
  },
});
