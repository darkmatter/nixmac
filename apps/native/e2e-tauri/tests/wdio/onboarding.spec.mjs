import {
  assertOnboardingVisible,
  clickCreateDefaultConfiguration,
  waitForFirstWindow,
} from './helpers/app-ui.mjs';
import {
  waitForConfigRepoFileExists,
  waitForConfigRepoClean,
  waitForConfigRepoInitialized,
} from './helpers/test-env.mjs';

describe('onboarding', () => {
  it('shows onboarding UI and bootstraps a new config repo', async () => {
    await waitForFirstWindow();

    await assertOnboardingVisible();

    await clickCreateDefaultConfiguration();

    await waitForConfigRepoInitialized();
    await waitForConfigRepoFileExists('flake.nix');
    await waitForConfigRepoClean();
  });
});
