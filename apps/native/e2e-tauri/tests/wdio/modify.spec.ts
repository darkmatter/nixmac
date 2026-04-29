// oxlint-disable no-unused-expressions
import {
  assertPromptHistoryContains,
  assertPromptFlowReachedEvolveReview,
  preparePromptTestCase,
  submitPromptMessage,
  waitForEvolveProcessingCycle,
} from './helpers/app-ui.js';
import { assertDiffContains, assertDiffDoesNotContain } from './helpers/git-helpers.js';
import {
  getConfigRepoGitDiff,
} from './helpers/test-env.js';
import { getMockVllmFixturePreset } from './helpers/mock-vllm-presets.js';
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

    let gitDiff = await getConfigRepoGitDiff();
    const changedPaths = (gitDiff as any).files.map((file: { path: string }) => file.path);
    expect(
      changedPaths.some((filePath: string) => filePath.endsWith('fonts.nix')),
      `Expected generated changes to include fonts.nix in git diff. Changed paths: ${changedPaths.join(', ')}`,
    ).to.be.true;
    assertDiffContains(gitDiff as any, 'fonts.nix', 'jetbrains-mono');
    assertDiffDoesNotContain(gitDiff as any, 'fonts.nix', 'nerdfonts.monaspace');

    await submitPromptMessage(secondPrompt);
    await waitForEvolveProcessingCycle();
    await assertPromptHistoryContains(secondPrompt);
    await assertPromptFlowReachedEvolveReview();

    gitDiff = await getConfigRepoGitDiff();
    assertDiffContains(gitDiff as any, 'fonts.nix', 'jetbrains-mono');
    assertDiffContains(gitDiff as any, 'fonts.nix', 'nerdfonts.monaspace');
  });
});
