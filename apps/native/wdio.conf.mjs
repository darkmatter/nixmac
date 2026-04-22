import { createWdioConfig } from './e2e-tauri/wdio.conf.base.mjs';

// Runs all suites. Uses initializeConfigRepo: true as the superset of
// requirements across all specs.
export const config = createWdioConfig({
  specs: ['./tests/wdio/**/*.spec.mjs'],
  setupOptions: { initializeConfigRepo: true },
});

