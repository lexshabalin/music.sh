import { test, expect } from "@playwright/test";
import { installApiMock, E2E_TOKEN } from "./install-api-mock.js";

test.beforeEach(async ({ page }) => {
  await installApiMock(page);
  await page.addInitScript((token) => {
    localStorage.setItem("musicsh_token", token);
    localStorage.setItem("musicsh_ui_lang", "en");
  }, E2E_TOKEN);
  await page.goto("/#/");
  await expect(page.locator(".home-dashboard")).toBeVisible();
});

test("play album from home starts queue and desktop player", async ({ page }) => {
  await page.locator(".home-recent-section .tile-play-btn").first().click();
  await expect(page.getByTestId("desktop-player")).toBeVisible();
  await expect(page.locator(".nowplaying-line1")).toContainText("E2E Track One");
});

test("play / pause toggles audio element", async ({ page }) => {
  await page.locator(".home-recent-section .tile-play-btn").first().click();
  await expect(page.getByTestId("desktop-player")).toBeVisible();

  await page.waitForFunction(() => {
    const a = document.querySelector('[data-testid="app-audio"]');
    return a && Number.isFinite(a.duration) && a.duration > 0;
  });

  const audio = page.getByTestId("app-audio");
  const pausedBefore = await audio.evaluate((el) => el.paused);
  await page.getByTestId("player-play-pause").click();
  await expect(audio).toHaveJSProperty("paused", !pausedBefore);
  await page.getByTestId("player-play-pause").click();
  await expect(audio).toHaveJSProperty("paused", pausedBefore);
});

test("next track updates now playing", async ({ page }) => {
  await page.locator(".home-recent-section .tile-play-btn").first().click();
  await expect(page.getByTestId("desktop-player")).toBeVisible();
  await page.waitForFunction(() => {
    const a = document.querySelector('[data-testid="app-audio"]');
    return a && Number.isFinite(a.duration) && a.duration > 0;
  });

  await page.getByTestId("player-next").click();
  await expect(page.locator(".nowplaying-line1")).toContainText("E2E Track Two");

  await page.getByTestId("player-prev").click();
  await expect(page.locator(".nowplaying-line1")).toContainText("E2E Track One");
});

test("seek slider changes currentTime", async ({ page }) => {
  await page.locator(".home-recent-section .tile-play-btn").first().click();
  await expect(page.getByTestId("desktop-player")).toBeVisible();

  await page.waitForFunction(() => {
    const a = document.querySelector('[data-testid="app-audio"]');
    return a && Number.isFinite(a.duration) && a.duration > 0.05;
  });

  const audio = page.getByTestId("app-audio");
  const dur = await audio.evaluate((el) => el.duration);
  expect(dur).toBeGreaterThan(0.05);

  const seek = page.getByTestId("player-seek");
  const max = Number(await seek.getAttribute("max"));
  // step="0.25" — pick a valid stepped value (e.g. half of max when max>=1).
  const target = max >= 1 ? Math.min(max, Math.floor((max / 2) / 0.25) * 0.25) : 0.25;
  await seek.fill(String(target));

  await expect
    .poll(async () => audio.evaluate((el) => el.currentTime), { timeout: 8000 })
    .toBeGreaterThan(0.05);
});

test("volume slider updates audio volume", async ({ page }) => {
  await page.locator(".home-recent-section .tile-play-btn").first().click();
  await expect(page.getByTestId("desktop-player")).toBeVisible();

  await page.getByTestId("player-volume").fill("0.25");

  await expect(page.getByTestId("app-audio")).toHaveJSProperty("volume", 0.25);
});
