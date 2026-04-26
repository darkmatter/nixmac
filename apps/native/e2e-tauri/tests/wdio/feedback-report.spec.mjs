import { expect } from 'chai';
import { browser } from '@wdio/globals';
import {
  assertElementMoreProminentThan,
  assertSelectorGone,
  assertVisibleText,
  clickWithRetry,
  getFieldValue,
  setFieldValue,
  waitForFirstWindow,
  waitForSelector,
} from './helpers/app-ui.mjs';

async function expectNoVisibleText(text) {
  const visible = await browser.execute((expectedText) => {
    const elements = Array.from(document.querySelectorAll('body *'));
    return elements.some((element) => {
      if (element.closest('#nixmac-e2e-proof-action, #nixmac-e2e-proof-cursor')) {
        return false;
      }

      if (element.textContent?.trim() !== expectedText) {
        return false;
      }

      const style = window.getComputedStyle(element);
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) !== 0 &&
        element.getClientRects().length > 0
      );
    });
  }, text);

  expect(visible, `Expected no visible text: ${text}`).to.equal(false);
}

describe('feedback and issue reporting', () => {
  it('covers header feedback mode and footer issue-report mode', async () => {
    await waitForFirstWindow();

    await clickWithRetry('button[aria-label="Give feedback"]', { label: 'Give feedback' });
    await assertVisibleText('Give feedback');
    await assertVisibleText('Suggestion');
    await assertVisibleText('Bug');
    await assertVisibleText('General');

    await clickWithRetry('label[for="bug"]', {
      label: 'Feedback type: Bug',
    });
    await assertElementMoreProminentThan(
      '[data-testid="feedback-type-bug"]',
      ['[data-testid="feedback-type-suggestion"]', '[data-testid="feedback-type-general"]'],
      'Bug feedback type selected state',
    );
    await waitForSelector('#expected-text');
    await setFieldValue('#feedback-text', 'The settings panel did not behave as expected.', {
      label: 'Feedback details',
    });
    await setFieldValue('#expected-text', 'The settings panel should keep my preference changes.', {
      label: 'Expected behavior',
    });
    await setFieldValue('#feedback-email', 'e2e@example.com', {
      label: 'Feedback email',
    });
    await clickWithRetry('#share-usage-stats', { label: 'Share usage stats checkbox' });
    await assertVisibleText('Send Feedback');
    await clickWithRetry('//button[normalize-space()="Cancel"]', {
      label: 'Cancel feedback',
      forceDomClick: true,
    });
    await assertSelectorGone('#feedback-text', { timeout: 5000 });

    await clickWithRetry('button[aria-label="Give feedback"]', { label: 'Reopen feedback' });
    await clickWithRetry('label[for="bug"]', {
      label: 'Feedback type: Bug after reopen',
    });
    await waitForSelector('#expected-text');
    expect(await getFieldValue('#feedback-text')).to.equal('');
    expect(await getFieldValue('#expected-text')).to.equal('');
    expect(await getFieldValue('#feedback-email')).to.equal('');
    await clickWithRetry('//button[normalize-space()="Cancel"]', {
      label: 'Cancel clean feedback',
      forceDomClick: true,
    });
    await assertSelectorGone('#feedback-text', { timeout: 5000 });

    await clickWithRetry('//button[normalize-space()="Report Issue"]', {
      label: 'Report Issue',
      forceDomClick: true,
    });
    await assertVisibleText('Report an issue');
    await assertVisibleText('DESCRIBE WHAT HAPPENED');
    await assertVisibleText('Send Report');
    await expectNoVisibleText('Suggestion');
    await expectNoVisibleText('Bug');
    await expectNoVisibleText('General');
    await assertSelectorGone('#expected-text', { timeout: 1000 });
    await clickWithRetry('//button[normalize-space()="Cancel"]', {
      label: 'Cancel issue report',
      forceDomClick: true,
    });
  });
});
