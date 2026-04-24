import { createWdioConfig } from './wdio.conf.base.mjs';

export const config = createWdioConfig({
  specs: ['./tests/wdio/onboarding.spec.mjs'],
  setupOptions: {
    initializeEmptyConfigDir: true,
  },
});
