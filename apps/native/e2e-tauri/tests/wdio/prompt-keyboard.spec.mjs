// oxlint-disable no-unused-expressions
import { expect } from 'chai';
import {
  assertPromptFlowReachedEvolveReview,
  assertPromptHistoryCount,
  assertPromptHistoryContains,
  assertPromptInputVisiblyContains,
  assertPromptInputValue,
  assertSendButtonEnabled,
  assertSendButtonLooksDisabled,
  clickSendButtonTwiceRapidly,
  clickWithRetry,
  focusPromptInput,
  pressKey,
  submitPromptMessage,
  waitForEvolveProcessingCycle,
  waitForFirstWindow,
} from './helpers/app-ui.mjs';
import {
  setMockVllmResponses,
  waitForConfigRepoGitDiffContaining,
} from './helpers/test-env.mjs';
import { getMockVllmFixturePreset } from './helpers/mock-vllm-presets.mjs';

describe('prompt keyboard and suggestions', () => {
  it('uses a prompt suggestion, records keyboard action proof, and reaches evolve review', async () => {
    await setMockVllmResponses({
      responseFiles: getMockVllmFixturePreset('basicPromptsAddFont'),
    });

    await waitForFirstWindow();
    await assertSendButtonEnabled(false);
    await assertSendButtonLooksDisabled();

    await clickWithRetry('//button[normalize-space()="Install vim"]', {
      label: 'Prompt suggestion: Install vim',
    });
    await assertPromptInputValue('Install vim');
    await assertPromptInputVisiblyContains('Install vim');
    await assertSendButtonEnabled(true);

    await focusPromptInput();
    await pressKey('Tab', 'Keyboard action before rapid submit');
    await clickSendButtonTwiceRapidly();
    await waitForEvolveProcessingCycle();
    await assertPromptFlowReachedEvolveReview({ expectedVisibleDiffText: 'jetbrains-mono' });
    await assertPromptHistoryContains('Install vim');
    await assertPromptHistoryCount('Install vim', 1);

    const diff = await waitForConfigRepoGitDiffContaining('jetbrains-mono');
    expect(diff.raw).to.contain('jetbrains-mono');

    await setMockVllmResponses({
      responseFiles: getMockVllmFixturePreset('basicPromptsAddFont'),
    });
    await submitPromptMessage('Install vim');
    await waitForEvolveProcessingCycle({ allowAlreadyInReview: true });
    await assertPromptHistoryCount('Install vim', 1);
  });
});
