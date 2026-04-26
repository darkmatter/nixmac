import {
  assertReturnedToInitialPromptScreen,
  chooseHostConfiguration,
  setConfigurationDirectory,
  waitForFirstWindow,
  waitForSetupScreen,
} from './helpers/app-ui.mjs';
import {
  loadE2eEnvironmentMetadata,
  waitForSettingsMatching,
} from './helpers/test-env.mjs';

describe('onboarding existing repo', () => {
  it('connects an existing nix-darwin repo and reaches the prompt screen', async () => {
    const metadata = await loadE2eEnvironmentMetadata();

    await waitForFirstWindow();
    await waitForSetupScreen();
    await setConfigurationDirectory(metadata.configDir, metadata.hostAttr);
    await chooseHostConfiguration(metadata.hostAttr);
    await assertReturnedToInitialPromptScreen();
    await waitForSettingsMatching((settings) =>
      settings.configDir === metadata.configDir && settings.hostAttr === metadata.hostAttr,
    );
  });
});
