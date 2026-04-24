import { browser, expect } from '@wdio/globals';
import {
  clickSettingsTabAndAssert,
  openSettingsDialog,
  waitForFirstWindow,
} from './helpers/app-ui.mjs';

async function expectVisibleText(text) {
  await browser.waitUntil(
    async () =>
      browser.execute((expectedText) => {
        const elements = Array.from(document.querySelectorAll('body *'));
        return elements.some((element) => {
          const style = window.getComputedStyle(element);
          const visible =
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity) !== 0 &&
            element.getClientRects().length > 0;
          return visible && element.textContent?.includes(expectedText);
        });
      }, text),
    {
      timeout: 10000,
      interval: 250,
      timeoutMsg: `Timed out waiting for visible text: ${text}`,
    },
  );
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
