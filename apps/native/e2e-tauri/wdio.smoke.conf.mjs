import { createWdioConfig } from './wdio.conf.base.mjs';

export const config = createWdioConfig({
  specs: ['../dist-e2e/tests/wdio/smoke.spec.js'],
  setupOptions: { initializeConfigRepo: true },
});
