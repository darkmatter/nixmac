// oxlint-disable no-unused-expressions
import {
  answerQuestion,
  assertPromptFlowReachedEvolveReview,
  registerPromptSuiteBeforeEach,
  submitPromptMessage,
} from './helpers/app-ui.mjs';
import {
  loadBuildState,
  loadEvolveState,
  getConfigRepoGitDiff,
} from './helpers/test-env.mjs';
import { assertDiffContains } from './helpers/git-helpers.mjs';
import { getMockVllmFixturePreset } from './helpers/mock-vllm-presets.mjs';
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
    const gitDiff = await getConfigRepoGitDiff();

    console.log('[wdio:basic-prompts] evolve_state');
    console.log(JSON.stringify(evolveState, null, 2));
    console.log('[wdio:basic-prompts] build_state');
    console.log(JSON.stringify(buildState, null, 2));
    console.log('[wdio:basic-prompts] git_diff_files');
    console.log(JSON.stringify(gitDiff.files, null, 2));

    expect(evolveState, 'evolveState should be defined').to.exist;
    expect(buildState, 'buildState should NOT be defined').to.not.exist;
    expect(
      evolveState.step,
      'Expected evolveState.step to be "evolve" after a successful prompt submission',
    ).to.equal('evolve');
    expect(
      Number(evolveState.currentChangesetId),
      'Expected evolveState.currentChangesetId to be greater than 0, indicating a changeset was created',
    ).to.be.greaterThan(0);

    const changedPaths = gitDiff.files.map((file) => file.path);
    expect(
      changedPaths.some((filePath) => filePath.endsWith('fonts.nix')),
      `Expected generated changes to include fonts.nix in git diff. Changed paths: ${changedPaths.join(', ')}`,
    ).to.be.true;
  });

  it('handles a prompt that triggers a docs search', async () => {
    await submitPromptMessage('Configure screenshots to save as PNG to ~/Screenshots');

    await assertPromptFlowReachedEvolveReview();

    // Verify that the diff modifies defaults.nix and includes a "~/Screenshots" path.
    const gitDiff = await getConfigRepoGitDiff();
    const changedPaths = gitDiff.files.map((file) => file.path);
    expect(
      changedPaths.some((filePath) => filePath.endsWith('defaults.nix')),
      `Expected generated changes to include defaults.nix in git diff. Changed paths: ${changedPaths.join(', ')}`,
    ).to.be.true;
    await assertDiffContains(gitDiff, 'defaults.nix', '~/Screenshots');
    await assertDiffContains(gitDiff, 'defaults.nix', 'png');
  });

  it('asks a question prompt and then submits a follow-up prompt based on the answer', async () => {
    await submitPromptMessage('Ask a question. You can chain this prompt with one of the others to create a complete test case.');

    // Wait for the assistant's question to appear in the UI and answer with a request to add a programming font.
    await answerQuestion('Add a programming font');
    await assertPromptFlowReachedEvolveReview();

    // Verify that the diff modifies fonts.nix, indicating that the follow-up prompt was processed correctly.
    const gitDiff = await getConfigRepoGitDiff();
    const changedPaths = gitDiff.files.map((file) => file.path);
    expect(
      changedPaths.some((filePath) => filePath.endsWith('fonts.nix')),
      `Expected generated changes to include fonts.nix in git diff. Changed paths: ${changedPaths.join(', ')}`,
    ).to.be.true;
  });
});