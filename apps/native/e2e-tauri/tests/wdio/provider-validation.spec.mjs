import {
  assertPromptInputValue,
  assertSendButtonEnabled,
  assertVisibleText,
  clickWithRetry,
  waitForFirstWindow,
} from './helpers/app-ui.mjs';

describe('provider validation blocks unsafe prompt submission', () => {
  it('keeps send disabled when vLLM is selected without a base URL', async () => {
    await waitForFirstWindow();
    await assertVisibleText('No base URL set', { timeout: 15000 });

    await clickWithRetry('//button[normalize-space()="Install vim"]', {
      label: 'Prompt suggestion: Install vim',
    });
    await assertPromptInputValue('Install vim');
    await assertSendButtonEnabled(false);
    await assertVisibleText('Open AI Models settings');
  });
});
