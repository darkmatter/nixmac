import { expect } from '@wdio/globals';
import {
  clickSettingsTabAndAssert,
  openFeedbackDialog,
  openSettingsDialog,
  waitForFirstWindow,
} from './helpers/app-ui.mjs';

describe('tauri app smoke', () => {
  it('opens and has at least one window', async () => {
    const handles = await waitForFirstWindow();
    expect(handles.length).toBeGreaterThan(0);
  });
});

describe('settings dialog', () => {
  it('opens and navigates all tabs', async () => {
    await waitForFirstWindow();
    await openSettingsDialog();

    const tabs = ['General', 'AI Models', 'API Keys', 'Preferences'];
    for (const tab of tabs) {
      await clickSettingsTabAndAssert(tab);
    }
  });
});

describe('feedback dialog', () => {
  it('opens the feedback dialog from header', async () => {
    await waitForFirstWindow();
    await openFeedbackDialog();
  });
});
