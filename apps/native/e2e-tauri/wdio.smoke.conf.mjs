import { createWdioConfig } from './wdio.conf.base.mjs';

export const config = createWdioConfig({
  specs: ['./tests/wdio/smoke.spec.mjs'],
  setupOptions: { initializeConfigRepo: true },
});
