// oxlint-disable no-unused-expressions
import {
  answerQuestion,
  assertPromptFlowReachedEvolveReview,
  registerPromptSuiteBeforeEach,
  submitPromptMessage,
} from './helpers/app-ui.js';
import {
  loadBuildState,
  loadEvolveState,
  getConfigRepoGitDiff,
} from './helpers/test-env.js';
import { assertDiffContains } from './helpers/git-helpers.js';
import { getMockVllmFixturePreset } from './helpers/mock-vllm-presets.js';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

use(chaiAsPromised);

describe('basic prompts', () => {
  registerPromptSuiteBeforeEach({
    fixtureByTestTitle: {
      'submits a basic prompt and reaches evolve review with diff':
        getMockVllmFixturePreset('basicPromptsAddFont'),
      'handles a prompt that triggers a docs search':
        getMockVllmFixturePreset('basicPromptsConfigureScreenshots'),
      'asks a question prompt and then submits a follow-up prompt based on the answer':
        getMockVllmFixturePreset('askQuestionPrompts'),
    },
  });

  it('submits a basic prompt and reaches evolve review with diff', async () => {
    await submitPromptMessage('add a new programming font to my system');

    await assertPromptFlowReachedEvolveReview();

    const evolveState = await loadEvolveState();
    const buildState = await loadBuildState();
    const gitDiff = await getConfigRepoGitDiff() as Awaited<ReturnType<typeof getConfigRepoGitDiff>> & { files: Array<{ path: string }> };

    console.log('[wdio:basic-prompts] evolve_state');
    console.log(JSON.stringify(evolveState, null, 2));
    console.log('[wdio:basic-prompts] build_state');
    console.log(JSON.stringify(buildState, null, 2));
    console.log('[wdio:basic-prompts] git_diff_files');
    console.log(JSON.stringify((gitDiff as any).files, null, 2));

    expect(evolveState, 'evolveState should be defined').to.exist;
    expect(buildState, 'buildState should NOT be defined').to.not.exist;
    expect(
      (evolveState as any)?.step,
      'Expected evolveState.step to be "evolve" after a successful prompt submission',
    ).to.equal('evolve');
    expect(
      Number((evolveState as any)?.currentChangesetId),
      'Expected evolveState.currentChangesetId to be greater than 0, indicating a changeset was created',
    ).to.be.greaterThan(0);

    const changedPaths = (gitDiff as any).files.map((file: { path: string }) => file.path);
    expect(
      changedPaths.some((filePath: string) => filePath.endsWith('fonts.nix')),
      `Expected generated changes to include fonts.nix in git diff. Changed paths: ${changedPaths.join(', ')}`,
    ).to.be.true;
  });

  it('handles a prompt that triggers a docs search', async () => {
    await submitPromptMessage('Configure screenshots to save as PNG to ~/Screenshots');

    await assertPromptFlowReachedEvolveReview();

    const gitDiff = await getConfigRepoGitDiff();
    const changedPaths = (gitDiff as any).files.map((file: { path: string }) => file.path);
    expect(
      changedPaths.some((filePath: string) => filePath.endsWith('defaults.nix')),
      `Expected generated changes to include defaults.nix in git diff. Changed paths: ${changedPaths.join(', ')}`,
    ).to.be.true;
    assertDiffContains(gitDiff as any, 'defaults.nix', '~/Screenshots');
    assertDiffContains(gitDiff as any, 'defaults.nix', 'png');
  });

  it('asks a question prompt and then submits a follow-up prompt based on the answer', async () => {
    await submitPromptMessage('Ask a question. You can chain this prompt with one of the others to create a complete test case.');

    await answerQuestion('Add a programming font');
    await assertPromptFlowReachedEvolveReview();

    const gitDiff = await getConfigRepoGitDiff();
    const changedPaths = (gitDiff as any).files.map((file: { path: string }) => file.path);
    expect(
      changedPaths.some((filePath: string) => filePath.endsWith('fonts.nix')),
      `Expected generated changes to include fonts.nix in git diff. Changed paths: ${changedPaths.join(', ')}`,
    ).to.be.true;
  });
});
