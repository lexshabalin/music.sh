import { test, expect } from "@playwright/test";
import { installApiMock, E2E_TOKEN } from "./install-api-mock.js";

test.beforeEach(async ({ page }) => {
  await installApiMock(page);
});

test("login reaches home dashboard", async ({ page }) => {
  await page.goto("/#/login");
  await expect(page.getByTestId("login-form")).toBeVisible();
  await page.getByTestId("login-username").fill("e2euser");
  await page.getByTestId("login-password").fill("anything");
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator(".home-dashboard")).toBeVisible();
  await expect(page.locator(".home-greeting__name")).toHaveText("E2E User");
});

test("session restores from token on reload", async ({ page }) => {
  await page.addInitScript((token) => {
    localStorage.setItem("musicsh_token", token);
    localStorage.setItem("musicsh_ui_lang", "en");
  }, E2E_TOKEN);
  await page.goto("/#/");
  await expect(page.locator(".home-dashboard")).toBeVisible();
  await expect(page.locator(".home-greeting__name")).toHaveText("E2E User");
});
