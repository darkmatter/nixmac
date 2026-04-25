import { $, $$, browser } from '@wdio/globals';
import { expect } from 'chai';

const ERROR_MESSAGE_SELECTOR = '[data-testid="widget-error-message"]';
const PROMPT_INPUT_SELECTOR = '#evolve-prompt-input, [data-testid="evolve-prompt-input"]';
const SEND_BUTTON_SELECTOR = '#evolve-prompt-send, [data-testid="evolve-prompt-send"]';

function actionLabelFromSelector(selector) {
  return String(selector)
    .replace(/^\/\/button\[normalize-space\(\)="([^"]+)"\]$/, '$1')
    .replace(/^\/\/button\[\.\/\/span\[normalize-space\(\)="([^"]+)"\]\]$/, '$1')
    .replace(/^button\[aria-label="([^"]+)"\]$/, '$1')
    .replace(/^#/, '')
    .replace(/^\[data-testid="([^"]+)"\]$/, '$1')
    .slice(0, 80);
}

function isXpathSelector(selector) {
  return String(selector).startsWith('/') || String(selector).startsWith('(');
}

export async function markProofAction({ kind, label, selector = null, value = null } = {}) {
  if (!browser?.execute) {
    return;
  }

  await browser.execute((action) => {
    const styleId = 'nixmac-e2e-proof-action-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        #nixmac-e2e-proof-cursor {
          position: fixed;
          left: 20px;
          top: 20px;
          width: 22px;
          height: 22px;
          border: 2px solid #38d9ff;
          border-radius: 999px;
          background: rgba(56, 217, 255, 0.14);
          box-shadow: 0 0 0 4px rgba(56, 217, 255, 0.12), 0 0 18px rgba(56, 217, 255, 0.5);
          transform: translate(-35%, -35%);
          transition: left 160ms ease, top 160ms ease, opacity 160ms ease;
          pointer-events: none;
          z-index: 2147483646;
        }
        #nixmac-e2e-proof-cursor::after {
          content: "";
          position: absolute;
          left: 7px;
          top: 7px;
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #ffffff;
        }
        #nixmac-e2e-proof-action {
          position: fixed;
          left: 10px;
          bottom: 10px;
          max-width: min(760px, calc(100vw - 20px));
          border: 1px solid rgba(148, 163, 184, 0.45);
          border-radius: 8px;
          background: rgba(15, 23, 42, 0.86);
          color: #f8fafc;
          font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          letter-spacing: 0;
          padding: 7px 10px;
          pointer-events: none;
          z-index: 2147483647;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        }
      `;
      document.head.appendChild(style);
    }

    const findNode = (selector) => {
      if (!selector) return null;
      try {
        if (selector.startsWith('/') || selector.startsWith('(')) {
          const result = document.evaluate(
            selector,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null,
          );
          return result.singleNodeValue instanceof Element ? result.singleNodeValue : null;
        }
        return document.querySelector(selector);
      } catch {
        return null;
      }
    };

    const target = findNode(action.selector);
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    if (target) {
      const rect = target.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        x = Math.min(window.innerWidth - 8, Math.max(8, rect.left + rect.width / 2));
        y = Math.min(window.innerHeight - 8, Math.max(8, rect.top + rect.height / 2));
      }
    }

    let cursor = document.getElementById('nixmac-e2e-proof-cursor');
    if (!cursor) {
      cursor = document.createElement('div');
      cursor.id = 'nixmac-e2e-proof-cursor';
      document.body.appendChild(cursor);
    }
    cursor.style.left = `${x}px`;
    cursor.style.top = `${y}px`;
    cursor.style.opacity = '1';

    let overlay = document.getElementById('nixmac-e2e-proof-action');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'nixmac-e2e-proof-action';
      document.body.appendChild(overlay);
    }

    const value = action.value ? `: ${String(action.value).slice(0, 90)}` : '';
    overlay.textContent = `${String(action.kind || 'action').toUpperCase()} ${String(action.label || 'UI action')}${value}`;
    overlay.dataset.kind = String(action.kind || 'action');
    overlay.dataset.updatedAt = String(Date.now());
  }, {
    kind: kind ?? 'action',
    label: label ?? actionLabelFromSelector(selector ?? 'UI action'),
    selector,
    value,
  });
}

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

  if (/not a git repository/i.test(message)) {
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

export async function waitForSelector(selector, { timeout = 15000, interval = 250 } = {}) {
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

export async function waitForSetupScreen() {
  await waitForSelector('//h2[normalize-space()="Welcome to nixmac"]', {
    timeout: 60000,
    interval: 500,
  });

  await waitForSelector('input[aria-label="1. Configuration Directory"]', {
    timeout: 60000,
    interval: 250,
  });
}

export async function setConfigurationDirectory(configDir, hostAttr) {
  const inputSelector = 'input[aria-label="1. Configuration Directory"]';
  await waitForSelector(inputSelector, { timeout: 60000, interval: 250 });

  const injectedValue = await browser.execute((selector, value) => {
    const el = document.querySelector(selector);
    if (!(el instanceof HTMLInputElement)) {
      return null;
    }

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    return el.value;
  }, inputSelector, configDir);

  if (injectedValue !== configDir) {
    const input = await $(inputSelector);
    await input.clearValue();
    await input.setValue(configDir);
  }

  await browser.keys(['Tab']);
  await browser.pause(250);

  let setupSeeded = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    setupSeeded = await browser.execute((dir, host) => {
      if (!window.__testWidget?.setSetupHosts) {
        return false;
      }
      window.__testWidget.setSetupHosts(dir, host);
      return true;
    }, configDir, hostAttr);

    const hostSelect = await $('#host-select');
    if (setupSeeded && (await hostSelect.isExisting())) {
      return;
    }

    await browser.pause(250);
  }

  expect(setupSeeded, 'Expected E2E widget test helper to seed setup hosts').to.equal(true);

  await waitForSelector('#host-select', {
    timeout: 60000,
    interval: 500,
  });
}

export async function chooseHostConfiguration(hostAttr) {
  const triggerSelector = '#host-select';
  await waitForSelector(triggerSelector, { timeout: 60000, interval: 500 });
  await clickWithRetry(triggerSelector);

  const optionSelector = `//*[@role="option" and normalize-space(.)="${hostAttr}"]`;
  await waitForSelector(optionSelector, { timeout: 10000, interval: 250 });
  await clickWithRetry(optionSelector);
}

// Some Tauri WebDriver clicks report success without activating small dialog/header controls.
// forceDomClick is reserved for those known-problem paths and is declared in scenario knownGaps.
export async function clickWithRetry(
  selector,
  { attempts = 12, interval = 250, label = null, forceDomClick = false } = {},
) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await failIfWidgetErrorPresent();
      const el = await $(selector);
      if (!(await el.isExisting())) {
        await browser.pause(interval);
        continue;
      }
      await markProofAction({
        kind: 'click',
        label: label ?? actionLabelFromSelector(selector),
        selector,
      });
      if (forceDomClick) {
        const clicked = await browser.execute((targetSelector) => {
          const isVisible = (node) => {
            if (!(node instanceof HTMLElement)) {
              return false;
            }

            const style = window.getComputedStyle(node);
            return (
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) !== 0 &&
              node.getClientRects().length > 0
            );
          };

          const findNode = () => {
            if (targetSelector.startsWith('/') || targetSelector.startsWith('(')) {
              const result = document.evaluate(
                targetSelector,
                document,
                null,
                XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                null,
              );
              for (let index = 0; index < result.snapshotLength; index += 1) {
                const node = result.snapshotItem(index);
                if (isVisible(node)) {
                  return node;
                }
              }
              return null;
            }

            return Array.from(document.querySelectorAll(targetSelector)).find(isVisible) ?? null;
          };

          const target = findNode();
          if (!(target instanceof HTMLElement)) {
            return false;
          }

          for (const eventName of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
            target.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }));
          }
          target.click();
          return true;
        }, selector);

        if (!clicked) {
          throw new Error(`DOM click could not find target: ${selector}`);
        }
      } else {
        try {
          await el.click();
        } catch (error) {
          if (isXpathSelector(selector)) {
            throw error;
          }

          const clicked = await browser.execute((targetSelector) => {
            const target = document.querySelector(targetSelector);
            if (!(target instanceof HTMLElement)) {
              return false;
            }

            target.click();
            return true;
          }, selector);

          if (!clicked) {
            throw error;
          }
        }
      }
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
  await waitForSelector(PROMPT_INPUT_SELECTOR, { timeout: 60000, interval: 250 });

  // Drive the Zustand store directly via the dev-only window test hook.
  // This is cleaner and more reliable than trying to simulate DOM events
  // through WebDriver against a React-controlled textarea.
  await markProofAction({
    kind: 'type',
    label: 'Prompt text',
    selector: PROMPT_INPUT_SELECTOR,
    value: promptMessage,
  });
  const usedStoreHook = await browser.execute((value) => {
    if (!window.__testWidget?.setEvolvePrompt) {
      return false;
    }

    window.__testWidget.setEvolvePrompt(value);
    return true;
  }, promptMessage);

  if (!usedStoreHook) {
    const injectedValue = await browser.execute((selector, value) => {
      const el = document.querySelector(selector);
      if (!(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) {
        return null;
      }

      const prototype =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      setter?.call(el, value);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.value;
    }, PROMPT_INPUT_SELECTOR, promptMessage);

    if (injectedValue !== promptMessage) {
      const promptInput = await $(PROMPT_INPUT_SELECTOR);
      await promptInput.clearValue();
      await promptInput.setValue(promptMessage);
    }
  }

  await waitForSelector(SEND_BUTTON_SELECTOR);
  await waitUntilOrFailOnError(
    async () => {
      const sendButton = await $(SEND_BUTTON_SELECTOR);
      return (await sendButton.isExisting()) && (await sendButton.isEnabled());
    },
    {
      timeout: 5000,
      interval: 200,
      timeoutMsg: 'Send button did not enable after typing prompt text',
    },
  );

  await clickWithRetry(SEND_BUTTON_SELECTOR, { attempts: 30, interval: 300, label: 'Send prompt' });
}

export async function pressKey(key, label = null) {
  await markProofAction({
    kind: 'key',
    label: label ?? key,
    selector: null,
    value: key,
  });
  await browser.keys([key]);
}

export async function focusPromptInput() {
  await waitForSelector(PROMPT_INPUT_SELECTOR, { timeout: 60000, interval: 250 });
  await clickWithRetry(PROMPT_INPUT_SELECTOR, { label: 'Prompt input' });
}

export async function submitPromptWithAnnotatedKeyboardProof() {
  await assertSendButtonEnabled(true);
  await focusPromptInput();
  await pressKey('Tab', 'Keyboard action before submit');
  await clickWithRetry(SEND_BUTTON_SELECTOR, { attempts: 30, interval: 300, label: 'Send prompt' });
}

export async function assertPromptInputValue(expectedValue) {
  await waitUntilOrFailOnError(
    async () =>
      await browser.execute((selector, expected) => {
        const el = document.querySelector(selector);
        return Boolean(el && 'value' in el && el.value === expected);
      }, PROMPT_INPUT_SELECTOR, expectedValue),
    {
      timeout: 5000,
      interval: 200,
      timeoutMsg: `Prompt input value did not become: ${expectedValue}`,
    },
  );
}

export async function assertSendButtonEnabled(enabled) {
  await waitUntilOrFailOnError(
    async () => {
      const sendButton = await $(SEND_BUTTON_SELECTOR);
      return (await sendButton.isExisting()) && (await sendButton.isEnabled()) === enabled;
    },
    {
      timeout: 5000,
      interval: 200,
      timeoutMsg: `Send button did not become ${enabled ? 'enabled' : 'disabled'}`,
    },
  );
}

export async function assertVisibleText(text, { timeout = 10000 } = {}) {
  await waitUntilOrFailOnError(
    async () =>
      browser.execute((expectedText) => {
        const elements = Array.from(document.querySelectorAll('body *'));
        return elements.some((element) => {
          if (element.closest('#nixmac-e2e-proof-action, #nixmac-e2e-proof-cursor')) {
            return false;
          }

          const style = window.getComputedStyle(element);
          const visible =
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity) !== 0 &&
            element.getClientRects().length > 0;
          return visible && element.textContent?.includes(expectedText);
        });
      }, text),
    {
      timeout,
      interval: 250,
      timeoutMsg: `Timed out waiting for visible text: ${text}`,
    },
  );
}

export async function assertSelectorGone(selector, { timeout = 10000, interval = 250 } = {}) {
  await waitUntilOrFailOnError(
    async () =>
      browser.execute((targetSelector, useXpath) => {
        const elements = useXpath
          ? (() => {
              const result = document.evaluate(
                targetSelector,
                document,
                null,
                XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                null,
              );
              return Array.from({ length: result.snapshotLength }, (_, index) =>
                result.snapshotItem(index),
              ).filter((node) => node instanceof Element);
            })()
          : Array.from(document.querySelectorAll(targetSelector));

        if (elements.length === 0) {
          return true;
        }

        return elements.every((element) => {
          const style = window.getComputedStyle(element);
          return (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            Number(style.opacity) === 0 ||
            element.getClientRects().length === 0
          );
        });
      }, selector, isXpathSelector(selector)),
    {
      timeout,
      interval,
      timeoutMsg: `Timed out waiting for selector to disappear: ${selector}`,
    },
  );
}

export async function setFieldValue(selector, value, { label = null, blur = true } = {}) {
  await waitForSelector(selector);
  await clickWithRetry(selector, { label: label ?? actionLabelFromSelector(selector) });
  await markProofAction({
    kind: 'type',
    label: label ?? actionLabelFromSelector(selector),
    selector,
    value,
  });

  const injectedValue = await browser.execute((fieldSelector, nextValue) => {
    const el = document.querySelector(fieldSelector);
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      return null;
    }

    const prototype =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(el, nextValue);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: nextValue, inputType: 'insertText' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value;
  }, selector, value);

  if (injectedValue !== value) {
    const el = await $(selector);
    await el.clearValue();
    await el.setValue(value);
  }

  if (blur) {
    await browser.keys(['Tab']);
    await browser.pause(250);
  }
}

export async function getInputType(selector) {
  await waitForSelector(selector);
  return browser.execute((fieldSelector) => {
    const el = document.querySelector(fieldSelector);
    return el instanceof HTMLInputElement ? el.type : null;
  }, selector);
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
