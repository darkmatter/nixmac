// oxlint-disable no-unused-expressions
import {
  assertPromptFlowReachedEvolveReview,
  assertReturnedToInitialPromptScreen,
  clickDiscardAndCancel,
  clickDiscardAndConfirm,
  registerPromptSuiteBeforeEach,
  submitPromptMessage,
} from './helpers/app-ui.mjs';
import {
  getConfigRepoGitDiff,
} from './helpers/test-env.mjs';
import { getMockVllmFixturePreset } from './helpers/mock-vllm-presets.mjs';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

use(chaiAsPromised);

describe('discard', () => {
  registerPromptSuiteBeforeEach({
    fixtureByTestTitle: {
      'submits a prompt, reaches evolve review, then discards and returns to initial state':
        getMockVllmFixturePreset('basicPromptsAddFont'),
      'submits a prompt, reaches evolve review, then cancels discard and stays on review':
        getMockVllmFixturePreset('basicPromptsAddFont'),
    },
  });

  it('submits a prompt, reaches evolve review, then discards and returns to initial state', async () => {
    await submitPromptMessage('add a new programming font to my system');

    await assertPromptFlowReachedEvolveReview();

    await clickDiscardAndConfirm();

    await assertReturnedToInitialPromptScreen();

    // Git should have no changes after discard.
    const gitDiff = await getConfigRepoGitDiff();
    expect(gitDiff.files.length, `Expected no changed files in git diff after discard, but found: ${gitDiff.files.map((f) => f.path).join(', ')}`).to.equal(0);
  });

  it('submits a prompt, reaches evolve review, then cancels discard and stays on review', async () => {
    await submitPromptMessage('add a new programming font to my system');

    await assertPromptFlowReachedEvolveReview();

    await clickDiscardAndCancel();

    await assertPromptFlowReachedEvolveReview();

    // Git should still have changes.
    const gitDiff = await getConfigRepoGitDiff();
    const changedPaths = gitDiff.files.map((file) => file.path);
    expect(
      changedPaths.some((filePath) => filePath.endsWith('fonts.nix')),
      `Expected generated changes to include fonts.nix in git diff. Changed paths: ${changedPaths.join(', ')}`,
    ).to.be.true;
  });
});
