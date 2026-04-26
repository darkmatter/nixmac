import {
  assertElementTextEquals,
  assertNoVisibleText,
  assertReturnedToInitialPromptScreen,
  assertSelectorGone,
  assertVisibleText,
  clickWithRetry,
  openSettingsDialog,
  seedDirtyRestoreHistory,
  waitForFirstWindow,
  waitForDirtyRestoreHistoryReady,
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

    await seedDirtyRestoreHistory();
    await waitForDirtyRestoreHistoryReady();
    await assertElementTextEquals('[data-testid="history-count-badge"]', '2', 'History count badge after dirty seed');
    await assertVisibleText('uncommitted');
    await assertVisibleText('(restore is disabled)');
    await assertVisibleText('restore target from yesterday');
    await clickWithRetry('//button[normalize-space()="Restore"]', {
      label: 'Restore while dirty',
      forceDomClick: true,
    });
    await assertVisibleText('(restore is disabled)');
    await assertNoVisibleText('Restore Commit e2e-re', { timeout: 5000 });

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
