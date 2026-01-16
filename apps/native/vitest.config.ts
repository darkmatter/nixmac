import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Run tests in main thread to avoid tinypool cleanup bug
    poolOptions: {
      forks: { singleFork: true },
    },
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
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
