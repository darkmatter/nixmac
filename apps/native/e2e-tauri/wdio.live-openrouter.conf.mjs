import { createWdioConfig } from './wdio.conf.base.mjs';

const openrouterApiKey =
  process.env.NIXMAC_E2E_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '';
const openrouterModel =
  process.env.NIXMAC_E2E_OPENROUTER_MODEL || 'anthropic/claude-sonnet-4';

export const config = createWdioConfig({
  scenario: 'live_openrouter_evolve_smoke',
  specs: ['./tests/wdio/live-openrouter.spec.mjs'],
  mochaTimeout: 360000,
  setupOptions: {
    initializeConfigRepo: true,
    settingsOverrides: {
      evolveProvider: 'openai',
      summaryProvider: 'openai',
      evolveModel: openrouterModel,
      summaryModel: 'openai/gpt-4o-mini',
      openrouterApiKey,
      openaiApiKey: '',
      maxIterations: 8,
      maxBuildAttempts: 1,
    },
  },
});
