import { createWdioConfig } from './wdio.conf.base.mjs';

export const config = createWdioConfig({
  scenario: 'discard_and_restore_state',
  specs: ['./tests/wdio/discard.spec.mjs'],
  setupOptions: {
    initializeConfigRepo: true,
    mockVllm: {},
  },
});
