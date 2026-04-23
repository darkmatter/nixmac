import { createWdioConfig } from './wdio.conf.base.mjs';

export const config = createWdioConfig({
  scenario: 'auto_evolve_basic_package',
  specs: ['./tests/wdio/basic-prompts.spec.mjs'],
  setupOptions: {
    initializeConfigRepo: true,
    mockVllm: {},
  },
});
