// oxlint-disable no-unused-expressions
import {
  assertPromptHistoryContains,
  assertPromptFlowReachedEvolveReview,
  preparePromptTestCase,
  submitPromptMessage,
  waitForEvolveProcessingCycle,
} from './helpers/app-ui.mjs';
import { assertDiffContains, assertDiffDoesNotContain } from './helpers/git-helpers.mjs';
import { getConfigRepoGitDiff } from './helpers/test-env.mjs';
import { getMockVllmFixturePreset } from './helpers/mock-vllm-presets.mjs';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

use(chaiAsPromised);

describe('modify', () => {
  it('submits sequential prompts on the evolve review screen', async () => {
    const firstPrompt = 'add a new programming font to my system. just choose a popular one and add it, no need to ask me any questions.';
    const secondPrompt = 'also add a second popular programming font';

    await preparePromptTestCase({
      responseFiles: getMockVllmFixturePreset('modifySequentialPrompts'),
    });

    await submitPromptMessage(firstPrompt);
    await waitForEvolveProcessingCycle();
    await assertPromptHistoryContains(firstPrompt);
    await assertPromptFlowReachedEvolveReview();

    // The diff should include JetBrains Mono as the added font:
    let gitDiff = await getConfigRepoGitDiff();
    const changedPaths = gitDiff.files.map((file) => file.path);
    expect(
      changedPaths.some((filePath) => filePath.endsWith('fonts.nix')),
      `Expected generated changes to include fonts.nix in git diff. Changed paths: ${changedPaths.join(', ')}`,
    ).to.be.true;
    await assertDiffContains(gitDiff, 'fonts.nix', 'jetbrains-mono');
    await assertDiffDoesNotContain(gitDiff, 'fonts.nix', 'nerdfonts.monaspace');

    // Now submit the second prompt to add another font (e.g. Nerd Fonts Monaspace)
    await submitPromptMessage(secondPrompt);
    await waitForEvolveProcessingCycle();
    await assertPromptHistoryContains(secondPrompt);
    await assertPromptFlowReachedEvolveReview();

    // The diff should now include the second font addition as well (e.g. Nerd Fonts Monaspace):
    gitDiff = await getConfigRepoGitDiff();
    await assertDiffContains(gitDiff, 'fonts.nix', 'jetbrains-mono');
    await assertDiffContains(gitDiff, 'fonts.nix', 'nerdfonts.monaspace');
  });
});
