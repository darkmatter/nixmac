import {
  assertOnboardingVisible,
  clickCreateDefaultConfiguration,
  waitForFirstWindow,
} from './helpers/app-ui.js';
import {
  waitForConfigRepoFileExists,
  waitForConfigRepoClean,
  waitForConfigRepoInitialized,
} from './helpers/test-env.js';

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
