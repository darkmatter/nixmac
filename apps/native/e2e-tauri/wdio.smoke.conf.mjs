import { createWdioConfig } from './wdio.conf.base.mjs';

export const config = createWdioConfig({
  scenario: 'settings_provider_change',
  specs: ['./tests/wdio/smoke.spec.mjs'],
  setupOptions: { initializeConfigRepo: true },
});
