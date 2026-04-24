import { $, expect } from '@wdio/globals';
import {
  clickSettingsTabAndAssert,
  openSettingsDialog,
  waitForFirstWindow,
} from './helpers/app-ui.mjs';

function xpathLiteral(value) {
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  return `concat(${value
    .split('"')
    .map((part) => `"${part}"`)
    .join(', \'"\', ')})`;
}

async function expectVisibleText(text) {
  await expect($(`//*[contains(normalize-space(), ${xpathLiteral(text)})]`)).toBeDisplayed();
}

async function expectTabContent(tab, expectedTexts) {
  await clickSettingsTabAndAssert(tab);
  for (const text of expectedTexts) {
    await expectVisibleText(text);
  }
}

describe('tauri app smoke', () => {
  it('opens and has at least one window', async () => {
    const handles = await waitForFirstWindow();
    expect(handles.length).toBeGreaterThan(0);
  });
});

describe('settings dialog', () => {
  it('opens and navigates all tabs', async () => {
    await waitForFirstWindow();
    await openSettingsDialog();

    await expectTabContent('General', [
      'Configuration Directory',
      'Send diagnostics to the nixmac team',
    ]);
    await expectTabContent('AI Models', [
      'Evolution Model',
      'Summary Model',
      'Evolution Limits',
    ]);
    await expectTabContent('API Keys', ['OpenRouter', 'OpenAI', 'Ollama', 'vLLM']);
    await expectTabContent('Preferences', [
      'Confirmation dialogs',
      'Build',
      'Clear / Discard',
      'Rollback',
    ]);
  });
});
