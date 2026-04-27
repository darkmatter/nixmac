import { createWdioConfig } from './wdio.conf.base.mjs';

export const config = createWdioConfig({
  scenario: 'settings_controls_persistence',
  specs: ['./tests/wdio/settings-controls.spec.mjs'],
  setupOptions: {
    initializeConfigRepo: true,
    mockVllm: {},
    settingsOverrides: {
      openrouterApiKey: 'sk-or-existing-openrouter-e2e-key',
    },
  },
});
