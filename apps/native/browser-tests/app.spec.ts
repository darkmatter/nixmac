import { expect, test } from "@playwright/test";

/**
 * Smoke test: the app shell should mount and render something under `#root`.
 *
 * This intentionally stays very loose — the UI lives behind the Tauri
 * window in production, so asserting on specific chrome is brittle here.
 * Replace with real user-flow specs as features stabilise.
 */
test("app shell mounts", async ({ page }) => {
  await page.goto("/");

  const root = page.locator("#root");
  await expect(root).toBeAttached();
  await expect(root).not.toBeEmpty();
});

test("page has expected title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/nixmac/i);
});
