import { expect } from '@wdio/globals';
import {
  clickSettingsTabAndAssert,
  openFeedbackDialog,
  openHistory,
  openSettingsDialog,
  waitForFirstWindow,
} from './helpers/app-ui.js';

describe('tauri app smoke', () => {
  it('opens and has at least one window', async () => {
    const handles = await waitForFirstWindow();
    expect(handles.length).toBeGreaterThan(0);
  });
});

describe('top-level views', () => {
  it('opens and navigates all tabs', async () => {
    await waitForFirstWindow();
    await openSettingsDialog();

    const tabs = ['General', 'AI Models', 'API Keys', 'Preferences'];
    for (const tab of tabs) {
      await clickSettingsTabAndAssert(tab);
    }
  });

  it('opens the feedback dialog from header', async () => {
    await waitForFirstWindow();
    await openFeedbackDialog();
  });

  it('opens history from header', async () => {
    await waitForFirstWindow();
    await openHistory();
  });
});
