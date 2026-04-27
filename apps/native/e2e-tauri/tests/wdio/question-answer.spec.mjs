// oxlint-disable no-unused-expressions
import { expect } from 'chai';
import {
  answerQuestion,
  assertPromptFlowReachedEvolveReview,
  submitPromptMessage,
  waitForFirstWindow,
} from './helpers/app-ui.mjs';
import {
  getConfigRepoGitDiff,
  setMockVllmResponses,
} from './helpers/test-env.mjs';
import { getMockVllmFixturePreset } from './helpers/mock-vllm-presets.mjs';

describe('question answer follow-up', () => {
  it('answers an inline agent question and continues the evolve flow', async () => {
    await setMockVllmResponses({
      responseFiles: getMockVllmFixturePreset('questionAnswerFollowup'),
    });

    await waitForFirstWindow();

    await submitPromptMessage(
      'Ask a question. You can chain this prompt with one of the others to create a complete test case.',
    );

    await answerQuestion('Add a programming font');
    await assertPromptFlowReachedEvolveReview({
      expectedVisibleDiffText: 'jetbrains-mono',
      timeout: 30000,
    });

    const gitDiff = await getConfigRepoGitDiff();
    const changedPaths = gitDiff.files.map((file) => file.path);
    expect(
      changedPaths.some((filePath) => filePath.endsWith('fonts.nix')),
      `Expected generated changes to include fonts.nix in git diff. Changed paths: ${changedPaths.join(', ')}`,
    ).to.be.true;
    expect(gitDiff.raw).to.contain('jetbrains-mono');
  });
});
