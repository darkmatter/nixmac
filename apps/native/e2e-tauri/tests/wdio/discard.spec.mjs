import {
  assertPromptFlowReachedEvolveReview,
  assertReturnedToInitialPromptScreen,
  clickDiscardAndCancel,
  clickDiscardAndConfirm,
  submitPromptMessage,
  waitForFirstWindow,
} from './helpers/app-ui.mjs';

describe('discard', () => {
  it('submits a prompt, reaches evolve review, then discards and returns to initial state', async () => {
    await waitForFirstWindow();

    await submitPromptMessage('add a new programming font to my system');

    await assertPromptFlowReachedEvolveReview();

    await clickDiscardAndConfirm();

    await assertReturnedToInitialPromptScreen();
  });

  it('submits a prompt, reaches evolve review, then cancels discard and stays on review', async () => {
    await waitForFirstWindow();

    await submitPromptMessage('add a new programming font to my system');

    await assertPromptFlowReachedEvolveReview();

    await clickDiscardAndCancel();

    await assertPromptFlowReachedEvolveReview();
  });
});
