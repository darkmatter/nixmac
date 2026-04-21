import { expect, test } from "@playwright/test";
import { injectTauriMocks } from "./helpers/mock-tauri";

/**
 * Flow: Evolve — Manual Edit
 *
 * The user has made direct edits to their nix files. The app detects
 * uncommitted changes and shows the "manualEvolve" step with a
 * "Build & Test" button.
 *
 * We boot directly into the manualEvolve routing state rather than
 * reproducing the full file-editing flow (which happens outside the app).
 * The build stream is simulated via window.__emitTauriEvent.
 */

const MANUAL_EVOLVE_STATE = {
  evolutionId: null, 
  currentChangesetId: null,
  changesetAtBuild: null,
  committable: false,
  backupBranch: null,
  step: "manualEvolve",
};

test.beforeEach(async ({ page }) => {
  await injectTauriMocks(page, {
    routingState: MANUAL_EVOLVE_STATE,
    finalizeApplyEvolveStep: "manualCommit",
  });
});

test("manual evolve: shows uncommitted changes UI with Build & Test button", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("button", { name: /Build & Test/i }),
  ).toBeVisible({ timeout: 10_000 });

  await expect(page.getByText("Uncommitted changes")).toBeVisible();
});

test("manual evolve: Build & Test routes to manualCommit step on success", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("button", { name: /Build & Test/i }),
  ).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: /Build & Test/i }).click();

  // Simulate the build stream completing successfully
  await page.evaluate(() => {
    (window as any).__emitTauriEvent("darwin:apply:end", { ok: true, code: 0 });
  });

  await expect(page.getByText("All changes active!")).toBeVisible({ timeout: 5_000 });
  await expect(
    page.getByRole("button", { name: /Build & Test/i }),
  ).not.toBeVisible();
});
