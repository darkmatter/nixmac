import { createWdioConfig } from './wdio.conf.base.mjs';
import { createVllmSetupOptionsForSuite } from '../dist-e2e/tests/wdio/helpers/vllm-test-mode.js';

export const config = createWdioConfig({
  specs: ['../dist-e2e/tests/wdio/modify.spec.js'],
  setupOptions: createVllmSetupOptionsForSuite({
    initializeConfigRepo: true,
  }),
});
