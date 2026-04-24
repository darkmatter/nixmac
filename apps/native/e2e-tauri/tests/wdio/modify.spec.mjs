import {
  assertPromptFlowReachedEvolveReview,
  submitPromptMessage,
  waitForFirstWindow,
} from './helpers/app-ui.mjs';
import {
  setMockVllmResponses,
  waitForConfigRepoGitDiffContaining,
} from './helpers/test-env.mjs';
import { getMockVllmFixturePreset } from './helpers/mock-vllm-presets.mjs';
import { expect } from 'chai';

describe('modify', () => {
  it('submits sequential prompts on the evolve review screen', async () => {
    const firstPrompt = 'add a new programming font to my system';
    const secondPrompt = 'also add Fira Code without discarding the existing change';

    await waitForFirstWindow();

    await setMockVllmResponses({
      responseFiles: getMockVllmFixturePreset('basicPromptsAddFont'),
    });
    await submitPromptMessage(firstPrompt);
    await assertPromptFlowReachedEvolveReview();

    const firstDiff = await waitForConfigRepoGitDiffContaining('jetbrains-mono');
    expect(
      firstDiff.raw,
      'Expected the first evolve run to leave an uncommitted JetBrains Mono change',
    ).to.contain('jetbrains-mono');

    await setMockVllmResponses({
      responseFiles: getMockVllmFixturePreset('manualEvolveAddFiraCode'),
    });
    await submitPromptMessage(secondPrompt);
    await assertPromptFlowReachedEvolveReview();

    const secondDiff = await waitForConfigRepoGitDiffContaining(['jetbrains-mono', 'fira-code']);
    expect(
      secondDiff.raw,
      'Expected the second evolve run to preserve the first change',
    ).to.contain('jetbrains-mono');
    expect(
      secondDiff.raw,
      'Expected the second evolve run to add a new Fira Code change',
    ).to.contain('fira-code');
  });
});
