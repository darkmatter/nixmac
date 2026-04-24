import { createWdioConfig } from './wdio.conf.base.mjs';
import { createVllmSetupOptionsForSuite } from './tests/wdio/helpers/vllm-test-mode.mjs';

export const config = createWdioConfig({
  specs: ['./tests/wdio/basic-prompts.spec.mjs'],
  setupOptions: createVllmSetupOptionsForSuite({
    initializeConfigRepo: true,
  }),
});
