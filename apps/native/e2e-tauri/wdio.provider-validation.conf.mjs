import { createWdioConfig } from './wdio.conf.base.mjs';

export const config = createWdioConfig({
  scenario: 'provider_validation_blocks_prompt',
  specs: ['./tests/wdio/provider-validation.spec.mjs'],
  setupOptions: {
    initializeConfigRepo: true,
    vllmApiBaseUrl: '',
    vllmApiKey: '',
  },
});
