// oxlint-disable no-unused-expressions
import {
  assertPromptFlowReachedEvolveReview,
  submitPromptMessage,
  waitForFirstWindow,
} from './helpers/app-ui.mjs';
import {
  loadBuildState,
  loadEvolveState,
  getConfigRepoGitDiff,
  setMockVllmResponses,
} from './helpers/test-env.mjs';
import { getMockVllmFixturePreset } from './helpers/mock-vllm-presets.mjs';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

use(chaiAsPromised);

describe('basic prompts', () => {
  it('submits a basic prompt and reaches evolve review with diff', async () => {
    await setMockVllmResponses({
      responseFiles: getMockVllmFixturePreset('basicPromptsAddFont'),
    });

    await waitForFirstWindow();

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
});
