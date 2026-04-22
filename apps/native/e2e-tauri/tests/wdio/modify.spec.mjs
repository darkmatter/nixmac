import {
  assertPromptHistoryContains,
  assertPromptFlowReachedEvolveReview,
  submitPromptMessage,
  waitForEvolveProcessingCycle,
  waitForFirstWindow,
} from './helpers/app-ui.mjs';

describe('modify', () => {
  it('submits sequential prompts on the evolve review screen', async () => {
    const firstPrompt = 'add a new programming font to my system';
    const secondPrompt = 'also add a cursive font';

    await waitForFirstWindow();

    await submitPromptMessage(firstPrompt);
    await waitForEvolveProcessingCycle();
    await assertPromptHistoryContains(firstPrompt);
    await assertPromptFlowReachedEvolveReview();

    await submitPromptMessage(secondPrompt);
    await waitForEvolveProcessingCycle();
    await assertPromptHistoryContains(secondPrompt);
    await assertPromptFlowReachedEvolveReview();
  });
});
