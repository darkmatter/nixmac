import { $, browser } from "@wdio/globals";

const DIFF_TAB_XPATH = '//button[@role="tab" and .//span[normalize-space()="Diff"]]';
const DIFF_SECTION_SELECTOR = '[data-testid="diff-section"]';
const CHEVRON_BUTTON_SELECTOR = "button:has(.lucide-chevron-right)";
const HUNK_PILL_SELECTOR = 'span[data-slot="badge"]';

export function diffRowSelector(filename: string): string {
  return `[data-testid="diff-row-${filename}"]`;
}

export async function activateDiffTab() {
  const trigger = await $(DIFF_TAB_XPATH);
  await trigger.waitForExist({ timeout: 15000 });
  await trigger.click();
  await $(DIFF_SECTION_SELECTOR).waitForExist({ timeout: 15000 });
}

export async function refreshGitStatus() {
  await (browser as any).execute(async () => {
    await (window as any).__testWidget?.refreshGitStatus?.();
  });
}

export async function getDiffRow(filename: string) {
  const row = await $(diffRowSelector(filename));
  await row.waitForExist({ timeout: 15000 });
  return row;
}

/**
 * Click the row's chevron (if not already open) and poll for the inner editor
 * view to appear. Uses fresh `$()` queries each tick — caching the element
 * handle here triggers ~60s of stale-element retries when Monaco re-mounts.
 */
export async function expandDiffRow(
  filename: string,
  viewTestId: "monaco-diff-view" | "monaco-file-view" = "monaco-diff-view",
) {
  const row = await getDiffRow(filename);
  const viewSelector = `[data-testid="${viewTestId}"]`;
  if (!(await row.$(viewSelector).isExisting())) {
    await row.$(CHEVRON_BUTTON_SELECTOR).click();
  }
  await (browser as any).waitUntil(async () => row.$(viewSelector).isExisting(), {
    timeout: 15000,
    interval: 200,
    timeoutMsg: `${viewTestId} never appeared for ${filename}`,
  });
  return row;
}

export async function getMonacoScrollTop(filename: string): Promise<number> {
  return (await (browser as any).execute(
    (sel: string) => {
      const linesContent = document
        .querySelector(sel)
        ?.querySelector(".editor.modified .lines-content") as HTMLElement | null;
      return linesContent ? Math.abs(parseFloat(linesContent.style.top || "0")) : 0;
    },
    `${diffRowSelector(filename)} [data-testid="monaco-diff-view"]`,
  )) as number;
}

export async function waitForScrollChange(
  filename: string,
  previous: number,
  { timeout = 5000, interval = 100 } = {},
): Promise<number> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const current = await getMonacoScrollTop(filename);
    if (current !== previous) return current;
    await (browser as any).pause(interval);
  }
  return previous;
}

export async function clickHunkPill(filename: string, index: number) {
  await (browser as any).execute(
    (sel: string, i: number) => {
      const pills = document.querySelector(sel)?.querySelectorAll('span[data-slot="badge"]');
      (pills?.[i] as HTMLElement | undefined)?.click();
    },
    diffRowSelector(filename),
    index,
  );
}

export async function getHunkPills(filename: string) {
  const row = await getDiffRow(filename);
  return row.$$(HUNK_PILL_SELECTOR);
}
