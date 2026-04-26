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

export async function answerQuestion(answerText) {
  const inputSelector = '[data-testid="question-prompt-input"]';
  const submitButtonSelector = '[data-testid="question-prompt-submit"]';

  await waitForSelector(inputSelector, { timeout: 60000, interval: 500 });
  await waitForSelector(submitButtonSelector);

  await markProofAction({
    kind: 'type',
    label: 'Question answer',
    selector: inputSelector,
    value: answerText,
  });
  await captureProofFrame('before-answer-Question answer');

  await browser.execute((value) => {
    const input = document.querySelector('[data-testid="question-prompt-input"]');
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, answerText);

  await captureProofFrame('after-answer-Question answer');
  await waitUntilOrFailOnError(
    async () => {
      const submitButton = await $(submitButtonSelector);
      return (await submitButton.isExisting()) && (await submitButton.isEnabled());
    },
    {
      timeout: 5000,
      interval: 200,
      timeoutMsg: 'Submit button did not enable after setting question prompt text',
    },
  );

  await clickWithRetry(submitButtonSelector, { attempts: 20, interval: 300 });
}

async function ensureVisualHelpers() {
  await browser.execute(() => {
    if (window.__nixmacE2eVisual) {
      return;
    }

    const parseCssColor = (value) => {
      const match = String(value || '').match(/rgba?\(([^)]+)\)/i);
      if (!match) return null;
      const parts = match[1].split(',').map((part) => part.trim());
      const [r, g, b] = parts.slice(0, 3).map((part) => Number.parseFloat(part));
      const a = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]);
      if (![r, g, b, a].every(Number.isFinite)) return null;
      return { r, g, b, a };
    };

    const relativeLuminance = ({ r, g, b }) => {
      const channel = (value) => {
        const normalized = value / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };

    const contrastRatio = (a, b) => {
      const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
      const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
      return (lighter + 0.05) / (darker + 0.05);
    };

    const elementsFor = (selector) => {
      if (!selector) return [];
      if (selector.startsWith('/') || selector.startsWith('(')) {
        const result = document.evaluate(
          selector,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null,
        );
        return Array.from({ length: result.snapshotLength }, (_, index) =>
          result.snapshotItem(index),
        ).filter((node) => node instanceof Element);
      }
      return Array.from(document.querySelectorAll(selector));
    };

    const effectiveVisibility = (element) => {
      if (!(element instanceof Element)) {
        return { visible: false, opacity: 0, reason: 'not_an_element' };
      }

      const rects = element.getClientRects();
      const box = element.getBoundingClientRect();
      if (rects.length === 0 || box.width <= 0 || box.height <= 0) {
        return { visible: false, opacity: 0, reason: 'zero_size' };
      }

      let opacity = 1;
      for (let current = element; current instanceof Element; current = current.parentElement) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none') {
          return { visible: false, opacity: 0, reason: 'display_none' };
        }
        if (style.visibility === 'hidden' || style.visibility === 'collapse') {
          return { visible: false, opacity: 0, reason: 'visibility_hidden' };
        }
        const currentOpacity = Number.parseFloat(style.opacity);
        opacity *= Number.isFinite(currentOpacity) ? currentOpacity : 1;
        if (opacity <= 0.05) {
          return { visible: false, opacity, reason: 'effective_opacity_zero' };
        }
      }

      return { visible: true, opacity, reason: 'visible' };
    };

    const backgroundFor = (element) => {
      for (let current = element; current instanceof Element; current = current.parentElement) {
        const color = parseCssColor(window.getComputedStyle(current).backgroundColor);
        if (color && color.a > 0.1) return color;
      }
      return { r: 0, g: 0, b: 0, a: 1 };
    };

    const textColorFor = (element) => {
      const style = window.getComputedStyle(element);
      const raw = style.webkitTextFillColor || style.color;
      return { raw, parsed: parseCssColor(raw) };
    };

    const visibleTextNode = (node, expectedText) => {
      if (!node.nodeValue?.includes(expectedText)) return false;
      const parent = node.parentElement;
      if (!parent || parent.closest('#nixmac-e2e-proof-action, #nixmac-e2e-proof-cursor')) {
        return false;
      }
      if (!effectiveVisibility(parent).visible) return false;
      const range = document.createRange();
      range.selectNodeContents(node);
      const visible = range.getClientRects().length > 0;
      range.detach();
      return visible;
    };

    window.__nixmacE2eVisual = {
      checkElementVisible(selector) {
        const element = elementsFor(selector)[0];
        if (!element) return { ok: false, reason: 'missing', selector };
        const visibility = effectiveVisibility(element);
        return visibility.visible ? { ok: true } : { ok: false, reason: visibility.reason, selector };
      },
      checkTextControlReadable(selector, expectedValue) {
        const element = elementsFor(selector)[0];
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
          return { ok: false, reason: 'missing_text_control', selector };
        }
        if (expectedValue !== undefined && element.value !== expectedValue) {
          return { ok: false, reason: `unexpected_value:${element.value}`, selector };
        }
        const visibility = effectiveVisibility(element);
        if (!visibility.visible) return { ok: false, reason: visibility.reason, selector };
        const textColor = textColorFor(element);
        if (String(textColor.raw || '').toLowerCase().includes('transparent')) {
          return { ok: false, reason: 'transparent_text', selector };
        }
        if (textColor.parsed && textColor.parsed.a <= 0.1) {
          return { ok: false, reason: 'transparent_text', selector };
        }
        if (textColor.parsed) {
          const ratio = contrastRatio(textColor.parsed, backgroundFor(element));
          if (ratio < 2.5) {
            return { ok: false, reason: `low_text_contrast:${ratio.toFixed(2)}`, selector };
          }
        }
        return { ok: true };
      },
      checkDisabledButtonLooksDisabled(selector) {
        const element = elementsFor(selector)[0];
        if (!(element instanceof HTMLButtonElement)) {
          return { ok: false, reason: 'missing_button', selector };
        }
        if (!element.disabled) {
          return { ok: false, reason: 'button_not_disabled', selector };
        }
        const visibility = effectiveVisibility(element);
        if (!visibility.visible) return { ok: false, reason: visibility.reason, selector };
        if (visibility.opacity > 0.75) {
          return { ok: false, reason: `disabled_opacity_too_high:${visibility.opacity.toFixed(2)}`, selector };
        }
        return { ok: true };
      },
      checkVisibleText(expectedText) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let current = walker.nextNode();
        while (current) {
          if (visibleTextNode(current, expectedText)) return { ok: true };
          current = walker.nextNode();
        }
        return { ok: false, reason: 'visible_text_missing', expectedText };
      },
      elementText(selector) {
        const element = elementsFor(selector)[0];
        if (!element) return { ok: false, reason: 'missing', selector };
        const visibility = effectiveVisibility(element);
        if (!visibility.visible) return { ok: false, reason: visibility.reason, selector };
        return { ok: true, text: element.textContent?.trim().replace(/\s+/g, ' ') || '' };
      },
      checkDestructiveButtonColor(selector) {
        const element = elementsFor(selector)[0];
        if (!(element instanceof HTMLElement)) {
          return { ok: false, reason: 'missing_button', selector };
        }
        const color = parseCssColor(window.getComputedStyle(element).backgroundColor);
        if (!color) return { ok: false, reason: 'missing_background_color', selector };
        const roseLike = color.r > 180 && color.r > color.g + 25 && color.r > color.b + 20 && color.g < 220;
        return roseLike
          ? { ok: true, color }
          : { ok: false, reason: `not_destructive_color:rgb(${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.b)})`, selector };
      },
      checkMoreProminentThan(selectedSelector, comparisonSelectors) {
        const selected = elementsFor(selectedSelector)[0];
        if (!selected) return { ok: false, reason: 'missing_selected', selectedSelector };
        const selectedOpacity = effectiveVisibility(selected).opacity;
        const comparison = comparisonSelectors
          .flatMap((selector) => elementsFor(selector))
          .map((element) => effectiveVisibility(element).opacity);
        const maxComparison = Math.max(0, ...comparison);
        return selectedOpacity >= maxComparison + 0.15
          ? { ok: true, selectedOpacity, maxComparison }
          : { ok: false, reason: `selected_not_prominent:${selectedOpacity.toFixed(2)}<=${maxComparison.toFixed(2)}`, selectedSelector };
      },
    };
  });
}

async function waitForFontsReady() {
  await browser.executeAsync((done) => {
    const ready = document.fonts?.ready;
    if (!ready) {
      done();
      return;
    }
    ready.then(() => done()).catch(() => done());
  });
}

async function assertVisualCheck(label, check, { timeout = 5000, interval = 200 } = {}) {
  await ensureVisualHelpers();
  await waitForFontsReady();
  let last = null;
  try {
    await waitUntilOrFailOnError(
      async () => {
        last = await check();
        return last?.ok === true;
      },
      {
        timeout,
        interval,
        timeoutMsg: `${label} visual assertion did not pass`,
      },
    );
  } catch (error) {
    const reason = last?.reason ? ` (${last.reason})` : '';
    expect.fail(`${label} should be visibly correct${reason}`);
  }
}

async function captureProofFrame(label) {
  const capture = globalThis.__nixmacCaptureE2eVideoFrame;
  if (typeof capture !== 'function') {
    return;
  }

  try {
    await capture(label);
  } catch (error) {
    console.warn(
      `[wdio:e2e-video] Failed to capture annotated proof frame: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
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

export async function assertVisualElementVisible(selector, label = selector) {
  await assertVisualCheck(label, () =>
    browser.execute((targetSelector) =>
      window.__nixmacE2eVisual.checkElementVisible(targetSelector), selector),
  );
}

export async function assertElementTextEquals(selector, expectedText, label = selector) {
  await assertVisualCheck(label, () =>
    browser.execute((targetSelector, expected) => {
      const result = window.__nixmacE2eVisual.elementText(targetSelector);
      if (!result.ok) return result;
      return result.text === expected
        ? { ok: true }
        : { ok: false, reason: `unexpected_text:${result.text}` };
    }, selector, expectedText),
  );
}

export async function assertPromptInputVisiblyContains(expectedValue) {
  await assertVisualCheck('Prompt input text', () =>
    browser.execute((selector, expected) =>
      window.__nixmacE2eVisual.checkTextControlReadable(selector, expected), PROMPT_INPUT_SELECTOR, expectedValue),
  );
}

export async function assertSendButtonLooksDisabled() {
  await assertVisualCheck('Disabled send button affordance', () =>
    browser.execute((selector) =>
      window.__nixmacE2eVisual.checkDisabledButtonLooksDisabled(selector), SEND_BUTTON_SELECTOR),
  );
}

export async function assertDestructiveButtonLooksDestructive(selector, label = selector) {
  await browser.pause(150);
  await assertVisualCheck(label, () =>
    browser.execute((targetSelector) =>
      window.__nixmacE2eVisual.checkDestructiveButtonColor(targetSelector), selector),
  );
}

export async function assertElementMoreProminentThan(selector, comparisonSelectors, label = selector) {
  await assertVisualCheck(label, () =>
    browser.execute((selectedSelector, otherSelectors) =>
      window.__nixmacE2eVisual.checkMoreProminentThan(selectedSelector, otherSelectors), selector, comparisonSelectors),
  );
}

export async function clickDiscardAndConfirm() {
  const discardButtonSelector = '[data-testid="evolve-discard-button"]';
  const confirmButtonSelector = '[data-testid="confirm-dialog-confirm"]';
  const cancelButtonSelector = '[data-testid="confirm-dialog-cancel"]';

  await browser.execute(() => {
    window.__testWidget?.setConfirmPrefs?.({ confirmClear: true });
  });
  await waitForSelector(discardButtonSelector);
  await clickWithRetry(discardButtonSelector, { label: 'Discard change', forceDomClick: true });

  // Confirmation dialog appears — click Confirm
  await waitForSelector(confirmButtonSelector, { timeout: 10000 });
  await assertElementTextEquals(cancelButtonSelector, 'Cancel', 'Discard dialog cancel label');
  await assertElementTextEquals(confirmButtonSelector, 'Confirm', 'Discard dialog confirm label');
  await assertDestructiveButtonLooksDestructive(confirmButtonSelector, 'Discard confirmation destructive button');
  await clickWithRetry(confirmButtonSelector);
}

export async function clickDiscardAndCancel() {
  const discardButtonSelector = '[data-testid="evolve-discard-button"]';
  const cancelButtonSelector = '[data-testid="confirm-dialog-cancel"]';
  const confirmButtonSelector = '[data-testid="confirm-dialog-confirm"]';

  await browser.execute(() => {
    window.__testWidget?.setConfirmPrefs?.({ confirmClear: true });
  });
  await waitForSelector(discardButtonSelector);
  await clickWithRetry(discardButtonSelector, { label: 'Discard change', forceDomClick: true });

  // Confirmation dialog appears — click Cancel
  await waitForSelector(cancelButtonSelector, { timeout: 10000 });
  await assertElementTextEquals(cancelButtonSelector, 'Cancel', 'Discard dialog cancel label');
  await assertElementTextEquals(confirmButtonSelector, 'Confirm', 'Discard dialog confirm label');
  await assertDestructiveButtonLooksDestructive(confirmButtonSelector, 'Discard confirmation destructive button');
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

    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    // Do not synthesize blur here. The real onBlur path may asynchronously clear hosts
    // after the E2E helper has seeded them, which can unmount #host-select on CI.
    return el.value;
  }, inputSelector, configDir);

  if (injectedValue !== configDir) {
    const input = await $(inputSelector);
    await input.clearValue();
    await input.setValue(configDir);
  }

  let setupSeeded = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    setupSeeded = await browser.execute((dir, host) => {
      if (!window.__testWidget?.setSetupHosts) {
        return false;
      }
      window.__testWidget.setSetupHosts(dir, host);
      return true;
    }, configDir, hostAttr);

    if (setupSeeded) {
      const hasStableHostSelect = await browser.execute(() => {
        const select = document.querySelector('#host-select');
        if (!(select instanceof HTMLElement)) {
          return false;
        }

        const style = window.getComputedStyle(select);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) !== 0 &&
          select.getClientRects().length > 0
        );
      });

      if (hasStableHostSelect) {
        return;
      }
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
  const actionLabel = label ?? actionLabelFromSelector(selector);
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
        label: actionLabel,
        selector,
      });
      await captureProofFrame(`before-click-${actionLabel}`);
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
      await browser.pause(200);
      await captureProofFrame(`after-click-${actionLabel}`);
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
  await captureProofFrame('before-type-Prompt text');
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
  await captureProofFrame('after-type-Prompt text');

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
  const actionLabel = label ?? key;
  await markProofAction({
    kind: 'key',
    label: actionLabel,
    selector: null,
    value: key,
  });
  await captureProofFrame(`before-key-${actionLabel}`);
  await browser.keys([key]);
  await browser.pause(200);
  await captureProofFrame(`after-key-${actionLabel}`);
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

export async function getFieldValue(selector) {
  await waitForSelector(selector);
  return browser.execute((fieldSelector) => {
    const el = document.querySelector(fieldSelector);
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      return null;
    }
    return el.value;
  }, selector);
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

export async function assertPromptHistoryCount(promptText, expectedCount) {
  await waitUntilOrFailOnError(
    async () =>
      await browser.execute((targetPrompt, count) => {
        const history = window.__testWidget?.getPromptHistory?.() ?? [];
        return history.filter((entry) => entry === targetPrompt).length === count;
      }, promptText, expectedCount),
    {
      timeout: 30000,
      interval: 500,
      timeoutMsg: `Timed out waiting for prompt history count ${expectedCount}: ${promptText}`,
    },
  );
}

export async function assertVisibleText(text, { timeout = 10000 } = {}) {
  await assertVisualCheck(
    `Visible text: ${text}`,
    () =>
      browser.execute((expectedText) =>
        window.__nixmacE2eVisual.checkVisibleText(expectedText), text),
    {
      timeout,
      interval: 250,
    },
  );
}

export async function assertNoVisibleText(text, { timeout = 5000, interval = 250 } = {}) {
  await ensureVisualHelpers();
  await browser.waitUntil(
    async () => {
      const result = await browser.execute((expectedText) =>
        window.__nixmacE2eVisual.checkVisibleText(expectedText), text);
      return result?.ok !== true;
    },
    {
      timeout,
      interval,
      timeoutMsg: `Timed out waiting for visible text to disappear: ${text}`,
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

export async function selectOptionByText(triggerSelector, optionText, { label = null } = {}) {
  const actionLabel = label ?? `${actionLabelFromSelector(triggerSelector)}: ${optionText}`;
  await waitForSelector(triggerSelector);
  await clickWithRetry(triggerSelector, { label: actionLabel });
  const optionSelector = `//*[@role="option" and normalize-space(.)="${optionText}"]`;
  await waitForSelector(optionSelector);
  await clickWithRetry(optionSelector, { label: actionLabel, forceDomClick: true });
}

export async function setFieldValue(selector, value, { label = null, blur = true } = {}) {
  const actionLabel = label ?? actionLabelFromSelector(selector);
  await waitForSelector(selector);
  await clickWithRetry(selector, { label: actionLabel });
  await markProofAction({
    kind: 'type',
    label: actionLabel,
    selector,
    value,
  });
  await captureProofFrame(`before-type-${actionLabel}`);

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
  await captureProofFrame(`after-type-${actionLabel}`);
}

export async function seedDirtyGitStatus(filePath = 'modules/homebrew.nix') {
  const seeded = await browser.execute((targetPath) => {
    if (!window.__testWidget?.setDirtyGitStatus) {
      return false;
    }
    window.__testWidget.setDirtyGitStatus(targetPath);
    return true;
  }, filePath);

  expect(seeded, 'Expected E2E widget test helper to seed dirty git status').to.equal(true);
}

export async function seedDirtyRestoreHistory() {
  const seeded = await browser.execute(() => {
    if (!window.__testWidget?.seedDirtyRestoreHistory) {
      return false;
    }
    window.__testWidget.seedDirtyRestoreHistory();
    return true;
  });

  expect(seeded, 'Expected E2E widget test helper to seed dirty restore history').to.equal(true);
}

export async function waitForDirtyRestoreHistoryReady() {
  let lastProbe = null;
  await waitUntilOrFailOnError(
    async () => {
      lastProbe = await browser.execute(() => window.__testWidget?.getStateProbe?.() ?? null);
      return (
        lastProbe?.step === 'history' &&
        lastProbe?.showHistory === true &&
        lastProbe?.historyCount === 2 &&
        lastProbe?.gitFileCount > 0
      );
    },
    {
      timeout: 5000,
      interval: 200,
      timeoutMsg: `Dirty restore history state was not ready. Last probe: ${JSON.stringify(lastProbe)}`,
    },
  );
}

export async function clickSendButtonTwiceRapidly() {
  await waitForSelector(SEND_BUTTON_SELECTOR);
  await waitUntilOrFailOnError(
    async () => {
      const sendButton = await $(SEND_BUTTON_SELECTOR);
      return (await sendButton.isExisting()) && (await sendButton.isEnabled());
    },
    {
      timeout: 5000,
      interval: 200,
      timeoutMsg: 'Send button did not enable before rapid double submit',
    },
  );

  await markProofAction({
    kind: 'click',
    label: 'Rapid double submit',
    selector: SEND_BUTTON_SELECTOR,
    value: null,
  });
  await captureProofFrame('before-click-Rapid double submit');
  await browser.execute((selector) => {
    const el = document.querySelector(selector);
    if (!(el instanceof HTMLButtonElement)) {
      return false;
    }
    el.click();
    el.click();
    return true;
  }, SEND_BUTTON_SELECTOR);
  await captureProofFrame('after-click-Rapid double submit');
}

export async function waitForWidgetErrorContaining(expectedText, { timeout = 60000, interval = 500 } = {}) {
  await browser.waitUntil(
    async () => {
      const elements = await $$(ERROR_MESSAGE_SELECTOR);
      if (elements.length === 0) return false;
      const text = (await elements[0].getText()).trim();
      return text.includes(expectedText);
    },
    {
      timeout,
      interval,
      timeoutMsg: `Timed out waiting for widget error containing: ${expectedText}`,
    },
  );
}

export async function waitForWidgetErrorMatching(pattern, { timeout = 60000, interval = 500 } = {}) {
  const matcher = pattern instanceof RegExp ? pattern : new RegExp(String(pattern));
  await browser.waitUntil(
    async () => {
      const elements = await $$(ERROR_MESSAGE_SELECTOR);
      if (elements.length === 0) return false;
      const text = (await elements[0].getText()).trim();
      return matcher.test(text);
    },
    {
      timeout,
      interval,
      timeoutMsg: `Timed out waiting for widget error matching: ${matcher}`,
    },
  );
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

export async function assertPromptFlowReachedEvolveReview({ expectedVisibleDiffText = null } = {}) {
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

  if (expectedVisibleDiffText) {
    await assertVisibleText(expectedVisibleDiffText, { timeout: 15000 });
  }
}

export async function assertNoWidgetError() {
  await failIfWidgetErrorPresent();
}
