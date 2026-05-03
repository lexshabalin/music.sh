/** Desktop bottom bar (excludes `player--mobile-mini`). */
export function desktopPlayerBar(page) {
  return page.locator("div.player:not(.player--mobile-mini)");
}

/** Single app `<audio>` (logged-in shell). */
export function appAudio(page) {
  return page.locator("audio").first();
}
