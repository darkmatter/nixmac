import { expect, test } from "@playwright/test";
import { injectTauriMocks } from "./helpers/mock-tauri";

/**
 * Flow: Auto Evolve
 *
 * User types a natural-language prompt describing the change they want.
 * The app calls the AI backend, which returns a result. The app then
 * advances from the "begin" step to the "evolve" review step, showing
 * the generated diff and a "Build & Test" button.
 *
 * What this test does NOT cover:
 * - Streaming event progress UI (darwin:evolve:event channel)
 * - Build/apply after review
 * - Error states
 */

test.beforeEach(async ({ page }) => {
  await injectTauriMocks(page);
});

test("app loads and shows the prompt input", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByPlaceholder("Describe changes to make to your configuration."),
  ).toBeVisible({ timeout: 10_000 });
});

test("submitting a prompt advances to the evolve review step", async ({ page }) => {
  await page.goto("/");

  const promptInput = page.getByPlaceholder(
    "Describe changes to make to your configuration.",
  );
  await expect(promptInput).toBeVisible({ timeout: 10_000 });

  await promptInput.fill("install neovim");
  await page.getByRole("button", { name: "Send" }).click();

  // Once the mock evolve result arrives, the app moves to the "evolve" step
  await expect(
    page.getByText("Ready to test-drive your changes?"),
  ).toBeVisible({ timeout: 15_000 });

  await expect(
    page.getByRole("button", { name: /Build & Test/i }),
  ).toBeVisible();
});
