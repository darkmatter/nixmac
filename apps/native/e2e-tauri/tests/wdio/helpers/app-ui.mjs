import { $, $$, browser } from '@wdio/globals';
import { expect } from 'chai';

const ERROR_MESSAGE_SELECTOR = '[data-testid="widget-error-message"]';

async function failIfWidgetErrorPresent() {
  let errorElements = [];
  try {
    errorElements = await $$(ERROR_MESSAGE_SELECTOR);
  } catch {
    return;
  }

  if (errorElements.length === 0) {
    return;
  }

  const message = (await errorElements[0].getText()).trim();
  if (!message) {
    return;
  }

  expect.fail(`Widget error surfaced during test: ${message}`);
}

async function waitUntilOrFailOnError(condition, options) {
  const { timeout, interval, timeoutMsg } = options;
  await browser.waitUntil(
    async () => {
      await failIfWidgetErrorPresent();
      return await condition();
    },
    {
      timeout,
      interval,
      timeoutMsg,
    },
  );
}

async function waitForSelector(selector, { timeout = 15000, interval = 250 } = {}) {
  await waitUntilOrFailOnError(
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

export async function clickDiscardAndConfirm() {
  const discardButtonSelector = '[data-testid="evolve-discard-button"]';
  const confirmButtonSelector = '[data-testid="confirm-dialog-confirm"]';

  await waitForSelector(discardButtonSelector);
  await clickWithRetry(discardButtonSelector);

  // Confirmation dialog appears — click Confirm
  await waitForSelector(confirmButtonSelector, { timeout: 10000 });
  await clickWithRetry(confirmButtonSelector);
}

export async function clickDiscardAndCancel() {
  const discardButtonSelector = '[data-testid="evolve-discard-button"]';
  const cancelButtonSelector = '[data-testid="confirm-dialog-cancel"]';

  await waitForSelector(discardButtonSelector);
  await clickWithRetry(discardButtonSelector);

  // Confirmation dialog appears — click Cancel
  await waitForSelector(cancelButtonSelector, { timeout: 10000 });
  await clickWithRetry(cancelButtonSelector);
}

export async function assertEvolveReviewGone() {
  await waitUntilOrFailOnError(
    async () => {
      const heading = await $('//h2[normalize-space()="What else can I change for you?"]');
      return !(await heading.isExisting());
    },
    {
      timeout: 60000,
      interval: 500,
      timeoutMsg: 'Timed out waiting for evolve review screen to disappear after discard',
    },
  );
}

export async function assertReturnedToInitialPromptScreen() {
  await waitForSelector('//h3[normalize-space()="Get started"]', {
    timeout: 60000,
    interval: 500,
  });

  await waitForSelector('#evolve-prompt-input, [data-testid="evolve-prompt-input"]', {
    timeout: 60000,
    interval: 250,
  });

  await assertEvolveReviewGone();
}

async function clickWithRetry(selector, { attempts = 12, interval = 250 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await failIfWidgetErrorPresent();
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

  const suffix =
    lastError instanceof Error && lastError.message
      ? ` Last error: ${lastError.message}`
      : '';
  expect.fail(`Failed to click selector after retries: ${selector}.${suffix}`);
}

export async function waitForFirstWindow(options = {}) {
  const timeout = options.timeout ?? 45000;
  const interval = options.interval ?? 500;

  await waitUntilOrFailOnError(
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

export async function submitPromptMessage(promptMessage) {
  const promptInputSelector = '#evolve-prompt-input, [data-testid="evolve-prompt-input"]';
  const sendButtonSelector = '#evolve-prompt-send, [data-testid="evolve-prompt-send"]';

  await waitForSelector(promptInputSelector, { timeout: 60000, interval: 250 });

  // Drive the Zustand store directly via the dev-only window test hook.
  // This is cleaner and more reliable than trying to simulate DOM events
  // through WebDriver against a React-controlled textarea.
  await browser.execute((value) => {
    window.__testWidget?.setEvolvePrompt(value);
  }, promptMessage);

  await waitForSelector(sendButtonSelector);
  await waitUntilOrFailOnError(
    async () => {
      const sendButton = await $(sendButtonSelector);
      return (await sendButton.isExisting()) && (await sendButton.isEnabled());
    },
    {
      timeout: 5000,
      interval: 200,
      timeoutMsg: 'Send button did not enable after typing prompt text',
    },
  );

  await clickWithRetry(sendButtonSelector, { attempts: 30, interval: 300 });
}

export async function waitForEvolveProcessingCycle({
  startedTimeout = 20000,
  completedTimeout = 120000,
} = {}) {
  await waitUntilOrFailOnError(
    async () =>
      await browser.execute(() => {
        return window.__testWidget?.isEvolveProcessing?.() === true;
      }),
    {
      timeout: startedTimeout,
      interval: 200,
      timeoutMsg: 'Timed out waiting for evolve processing to start',
    },
  );

  await waitUntilOrFailOnError(
    async () =>
      await browser.execute(() => {
        return window.__testWidget?.isEvolveProcessing?.() === false;
      }),
    {
      timeout: completedTimeout,
      interval: 500,
      timeoutMsg: 'Timed out waiting for evolve processing to complete',
    },
  );
}

export async function assertPromptHistoryContains(promptText) {
  await waitUntilOrFailOnError(
    async () =>
      await browser.execute((targetPrompt) => {
        const history = window.__testWidget?.getPromptHistory?.() ?? [];
        return history.includes(targetPrompt);
      }, promptText),
    {
      timeout: 120000,
      interval: 500,
      timeoutMsg: `Timed out waiting for prompt history to include: ${promptText}`,
    },
  );
}

export async function assertPromptFlowReachedEvolveReview() {
  await waitForSelector('//h2[normalize-space()="What else can I change for you?"]', {
    timeout: 120000,
    interval: 500,
  });

  await waitForSelector('//h2[normalize-space()="What\'s changed"]', {
    timeout: 120000,
    interval: 500,
  });

  await waitForSelector('//button[normalize-space()="Diff"]');
  await clickWithRetry('//button[normalize-space()="Diff"]');

  await waitUntilOrFailOnError(
    async () => {
      const noDiffMatches = await $$('//*[normalize-space()="No diff available"]');
      return noDiffMatches.length === 0;
    },
    {
      timeout: 120000,
      interval: 500,
      timeoutMsg: 'Timed out waiting for generated git diff content',
    },
  );
}

export async function assertNoWidgetError() {
  await failIfWidgetErrorPresent();
}
