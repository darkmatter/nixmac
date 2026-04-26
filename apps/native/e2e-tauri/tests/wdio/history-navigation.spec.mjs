import {
  assertElementTextEquals,
  assertReturnedToInitialPromptScreen,
  assertSelectorGone,
  assertVisibleText,
  clickWithRetry,
  openSettingsDialog,
  waitForFirstWindow,
  waitForSelector,
} from './helpers/app-ui.mjs';

describe('history and settings navigation', () => {
  it('opens and closes history and settings controls', async () => {
    await waitForFirstWindow();
    await assertReturnedToInitialPromptScreen();

    await clickWithRetry('button[aria-label="History"]', { label: 'Open history' });
    await waitForSelector('//h2[normalize-space()="History"]');
    await assertVisibleText('History');
    await assertElementTextEquals('[data-testid="history-count-badge"]', '1', 'History count badge');
    await assertVisibleText('initial nix config state');

    await clickWithRetry('button[aria-label="History"]', {
      label: 'Close history',
      forceDomClick: true,
    });
    await assertReturnedToInitialPromptScreen();

    await openSettingsDialog();
    await waitForSelector('button[aria-label="Close settings"]');
    await assertVisibleText('Settings');
    await clickWithRetry('button[aria-label="Close settings"]', {
      label: 'Close settings',
      forceDomClick: true,
    });
    await assertSelectorGone('button[aria-label="Close settings"]');
  });
});
