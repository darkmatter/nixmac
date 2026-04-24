import { createWdioConfig } from './wdio.conf.base.mjs';

export const config = createWdioConfig({
  specs: ['./tests/wdio/basic-prompts.spec.mjs'],
  setupOptions: {
    initializeConfigRepo: true,
    mockVllm: {},
  },
});
