import { createWdioConfig } from './e2e-tauri/wdio.conf.base.mjs';

// Runs all suites that start from an already configured app state. Onboarding
// intentionally uses a separate config because it must start without settings.
export const config = createWdioConfig({
  scenario: 'tauri_wdio_all',
  specs: [
    './tests/wdio/basic-prompts.spec.mjs',
    './tests/wdio/discard.spec.mjs',
    './tests/wdio/feedback-report.spec.mjs',
    './tests/wdio/history-navigation.spec.mjs',
    './tests/wdio/modify.spec.mjs',
    './tests/wdio/prompt-keyboard.spec.mjs',
    './tests/wdio/settings-controls.spec.mjs',
    './tests/wdio/smoke.spec.mjs',
  ],
  setupOptions: {
    initializeConfigRepo: true,
    mockVllm: {},
  },
});
