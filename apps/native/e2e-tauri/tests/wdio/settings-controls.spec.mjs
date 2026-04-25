import { expect } from 'chai';
import { $ } from '@wdio/globals';
import {
  clickSettingsTabAndAssert,
  clickWithRetry,
  getInputType,
  openSettingsDialog,
  setFieldValue,
  waitForFirstWindow,
  waitForSelector,
} from './helpers/app-ui.mjs';
import { waitForSettingsMatching } from './helpers/test-env.mjs';

const CONFIRM_SWITCHES = [
  { label: 'Build', key: 'confirmBuild' },
  { label: 'Clear / Discard', key: 'confirmClear' },
  { label: 'Rollback', key: 'confirmRollback' },
];

function switchSelector(label) {
  return `//div[normalize-space()="${label}"]/ancestor::div[.//*[@role="switch"]][1]//*[@role="switch"]`;
}

async function switchChecked(label) {
  const selector = switchSelector(label);
  await waitForSelector(selector);
  const el = await $(selector);
  return (await el.getAttribute('aria-checked')) === 'true';
}

describe('settings controls persistence', () => {
  it('mutates representative settings controls and verifies settings.json', async () => {
    await waitForFirstWindow();
    await openSettingsDialog();

    await clickSettingsTabAndAssert('Preferences');
    const expectedPrefs = {};
    for (const { label, key } of CONFIRM_SWITCHES) {
      const nextValue = !(await switchChecked(label));
      expectedPrefs[key] = nextValue;
      await clickWithRetry(switchSelector(label), { label: `${label} confirmation switch` });
    }

    await waitForSettingsMatching((settings) =>
      CONFIRM_SWITCHES.every(({ key }) => settings[key] === expectedPrefs[key]),
    );

    await clickSettingsTabAndAssert('API Keys');
    await setFieldValue('#ollamaApiBaseUrl', 'http://127.0.0.1:11434', {
      label: 'Ollama API base URL',
    });
    await setFieldValue('#vllmApiBaseUrl', 'http://127.0.0.1:8000/v1', {
      label: 'vLLM API base URL',
    });
    await setFieldValue('#vllmApiKey', 'test-vllm-key', {
      label: 'vLLM API key',
    });

    expect(await getInputType('#vllmApiKey')).to.equal('password');
    await clickWithRetry('button[aria-label="Show"]', { label: 'Show vLLM API key' });
    expect(await getInputType('#vllmApiKey')).to.equal('text');

    await waitForSettingsMatching(
      (settings) =>
        settings.ollamaApiBaseUrl === 'http://127.0.0.1:11434' &&
        settings.vllmApiBaseUrl === 'http://127.0.0.1:8000/v1' &&
        settings.vllmApiKey === 'test-vllm-key',
    );

    await clickSettingsTabAndAssert('AI Models');
    await setFieldValue('#maxIterations', '42', { label: 'Max iterations' });
    await setFieldValue('#maxBuildAttempts', '3', { label: 'Max build attempts' });

    await waitForSettingsMatching(
      (settings) => settings.maxIterations === 42 && settings.maxBuildAttempts === 3,
    );
  });
});
