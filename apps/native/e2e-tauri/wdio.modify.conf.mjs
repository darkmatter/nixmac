import { createWdioConfig } from './wdio.conf.base.mjs';

export const config = createWdioConfig({
  specs: ['./tests/wdio/modify.spec.mjs'],
  setupOptions: { initializeConfigRepo: true },
});
