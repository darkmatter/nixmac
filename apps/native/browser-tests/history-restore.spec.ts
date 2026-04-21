import { expect, test } from "@playwright/test";
import { injectTauriMocks } from "./helpers/mock-tauri";

/**
 * Flow: History Restore
 *
 * The user opens the history panel, sees past commits, clicks Restore
 * on an older commit, and confirms the restore.
 *
 * What this test does NOT cover:
 * - The rebuild stream that executes after confirming (requires streaming
 *   backend events via window.__emitTauriEvent)
 * - Error states during restore
 */

const MOCK_HISTORY = [
  {
    hash: "abc1111",
    message: "feat: add neovim",
    createdAt: Math.floor(Date.now() / 1000),
    isBuilt: true,
    isBase: false,
    isExternal: false,
    fileCount: 1,
    commit: null,
    changeMap: null,
    unsummarizedHashes: [],
    rawChanges: [],
    originMessage: null,
    originHash: null,
    isOrphanedRestore: false,
    isUndone: false,
  },
  {
    hash: "def2222",
    message: "chore: initial setup",
    createdAt: Math.floor(Date.now() / 1000) - 86400,
    isBuilt: false,
    isBase: false,
    isExternal: false,
    fileCount: 2,
    commit: null,
    changeMap: null,
    unsummarizedHashes: [],
    rawChanges: [],
    originMessage: null,
    originHash: null,
    isOrphanedRestore: false,
    isUndone: false,
  },
];

test.beforeEach(async ({ page }) => {
  await injectTauriMocks(page, { historyItems: MOCK_HISTORY });
});

test("history panel shows commit list", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "History" }).click();

  await expect(page.getByText("feat: add neovim")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("chore: initial setup")).toBeVisible();
});

test("clicking Restore shows confirmation dialog", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByText("chore: initial setup")).toBeVisible({ timeout: 5_000 });

  await page.getByRole("button", { name: "Restore" }).last().click();

  await expect(
    page.getByRole("button", { name: "Confirm Restore" }),
  ).toBeVisible({ timeout: 3_000 });
  await expect(
    page.getByRole("button", { name: "Cancel" }),
  ).toBeVisible();
});
