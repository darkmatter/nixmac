import { createWdioConfig } from './wdio.conf.base.mjs';

function trimEnv(name) {
  return typeof process.env[name] === 'string' ? process.env[name].trim() : '';
}

const openrouterApiKey =
  trimEnv('NIXMAC_E2E_OPENROUTER_API_KEY') ||
  (trimEnv('NIXMAC_E2E_REQUIRE_DEDICATED_OPENROUTER_KEY') === '1'
    ? ''
    : trimEnv('OPENROUTER_API_KEY'));
const openrouterModel =
  process.env.NIXMAC_E2E_OPENROUTER_MODEL || 'openai/gpt-4.1';
const openrouterSummaryModel =
  process.env.NIXMAC_E2E_OPENROUTER_SUMMARY_MODEL || 'openai/gpt-4o-mini';

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
      summaryModel: openrouterSummaryModel,
      openrouterApiKey,
      openaiApiKey: '',
      maxIterations: 8,
      maxBuildAttempts: 3,
    },
  },
});
