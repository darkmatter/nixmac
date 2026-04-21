import { $, browser } from '@wdio/globals';

async function waitForSelector(selector, { timeout = 15000, interval = 250 } = {}) {
  await browser.waitUntil(
    async () => {
      try {
        const el = await $(selector);
        return await el.isExisting();
      } catch {
        return false;
      }
    },
    {
      timeout,
      interval,
      timeoutMsg: `Timed out waiting for selector: ${selector}`,
    },
  );
}

async function clickWithRetry(selector, { attempts = 12, interval = 250 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const el = await $(selector);
      if (!(await el.isExisting())) {
        await browser.pause(interval);
        continue;
      }
      await el.click();
      return;
    } catch (error) {
      lastError = error;
      await browser.pause(interval);
    }
  }

  throw lastError ?? new Error(`Failed to click selector after retries: ${selector}`);
}

export async function waitForFirstWindow(options = {}) {
  const timeout = options.timeout ?? 45000;
  const interval = options.interval ?? 500;

  await browser.waitUntil(
    async () => {
      try {
        const handles = await browser.getWindowHandles();
        return handles.length > 0;
      } catch {
        return false;
      }
    },
    {
      timeout,
      interval,
      timeoutMsg: 'Timed out waiting for the first app window to appear',
    },
  );

  const handles = await browser.getWindowHandles();
  await browser.switchToWindow(handles[0]);
  return handles;
}

export async function openSettingsDialog() {
  const settingsButtonSelector = 'button[aria-label="Settings"]';
  await waitForSelector(settingsButtonSelector);
  await clickWithRetry(settingsButtonSelector);

  await waitForSelector('button[aria-label="Close settings"]');
}

export async function clickSettingsTabAndAssert(tabName) {
  const tabButtonSelector = `//button[.//span[normalize-space()="${tabName}"]]`;
  await waitForSelector(tabButtonSelector);
  await clickWithRetry(tabButtonSelector);

  await waitForSelector(`//h2[normalize-space()="${tabName}"]`);
}
