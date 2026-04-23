import { createWdioConfig } from './wdio.conf.base.mjs';

export const config = createWdioConfig({
  scenario: 'onboarding_existing_repo',
  specs: ['./tests/wdio/onboarding.spec.mjs'],
  setupOptions: {
    initializeConfigRepo: true,
    writeSettings: false,
  },
});
