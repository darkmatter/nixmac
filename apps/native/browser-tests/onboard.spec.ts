import { expect, test } from "@playwright/test";
import { injectTauriMocks } from "./helpers/mock-tauri";

/**
 * Flow: Onboard
 *
 * Two paths through the setup screen:
 *
 * A) Fresh install — configDir is null. The app shows the setup screen.
 *    The user clicks Browse, picks a directory, selects a host, and lands
 *    on the begin step with the prompt input visible.
 *
 * B) Returning user — configDir and hostAttr are already set. The app
 *    skips the setup screen entirely and boots straight to begin.
 */

test("fresh install: shows setup screen with directory picker", async ({ page }) => {
  await injectTauriMocks(page, {
    configDir: null,
    hostAttr: null,
    pickedConfigDir: "/mock/nixconfig",
  });
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Browse" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByPlaceholder("Not selected")).toBeVisible();
  await expect(
    page.getByPlaceholder("Describe changes to make to your configuration."),
  ).not.toBeVisible();
});

test("fresh install: browse → host select → begin step", async ({ page }) => {
  await injectTauriMocks(page, {
    configDir: null,
    hostAttr: null,
    pickedConfigDir: "/mock/nixconfig",
    hosts: ["Test-MacBook"],
  });
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Browse" })).toBeVisible({
    timeout: 10_000,
  });

  await page.getByRole("button", { name: "Browse" }).click();

  await expect(
    page.getByText("Choose a host configuration"),
  ).toBeVisible({ timeout: 5_000 });

  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "Test-MacBook" }).click();

  await expect(
    page.getByPlaceholder("Describe changes to make to your configuration."),
  ).toBeVisible({ timeout: 5_000 });
});

test("returning user: skips setup and lands on begin step", async ({ page }) => {
  await injectTauriMocks(page);
  await page.goto("/");

  await expect(
    page.getByPlaceholder("Describe changes to make to your configuration."),
  ).toBeVisible({ timeout: 10_000 });

  await expect(page.getByText("Welcome to nixmac")).not.toBeVisible();
});
