import { createWdioConfig } from "./wdio.conf.base.mjs";

export const config = createWdioConfig({
  specs: ["../dist-e2e/tests/wdio/manual-changes.spec.js"],
  setupOptions: { initializeConfigRepo: true },
});
