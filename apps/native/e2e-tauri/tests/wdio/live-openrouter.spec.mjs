// oxlint-disable no-unused-expressions
import {
  assertPromptFlowReachedEvolveReview,
  submitPromptMessage,
  waitForFirstWindow,
} from './helpers/app-ui.mjs';
import {
  loadBuildState,
  waitForConfigRepoGitDiffContaining,
  waitForEvolveStateWithChangeset,
} from './helpers/test-env.mjs';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

use(chaiAsPromised);

describe('live OpenRouter evolve smoke', () => {
  it('uses a real OpenRouter key to reach evolve review with a generated diff', async () => {
    await waitForFirstWindow({ timeout: 60000 });

    await submitPromptMessage(
      'Add vim to environment.systemPackages in this nix-darwin configuration. Make the smallest valid Nix change.',
    );

    await assertPromptFlowReachedEvolveReview({ timeout: 240000 });

    const evolveState = await waitForEvolveStateWithChangeset({ timeout: 240000 });
    const buildState = await loadBuildState();
    const gitDiff = await waitForConfigRepoGitDiffContaining('vim', {
      timeout: 240000,
    });

    console.log('[wdio:live-openrouter] evolve_state');
    console.log(JSON.stringify(evolveState, null, 2));
    console.log('[wdio:live-openrouter] build_state');
    console.log(JSON.stringify(buildState, null, 2));
    console.log('[wdio:live-openrouter] git_diff_files');
    console.log(JSON.stringify(gitDiff.files, null, 2));

    expect(evolveState, 'evolveState should be defined').to.exist;
    expect(buildState, 'live provider smoke should stop at review, before build/apply').to.not.exist;
    expect(evolveState.step).to.equal('evolve');
    expect(Number(evolveState.currentChangesetId)).to.be.greaterThan(0);
    expect(gitDiff.raw, 'Expected live provider output to add vim somewhere in the generated diff').to.match(/vim/i);
  });
});
