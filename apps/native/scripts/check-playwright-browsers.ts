// CI canary: prove the whole browser-launch chain works before the expensive
// storybook/snapshot steps run. Launching chromium end-to-end verifies that
// the browsers registry resolves, the nix store path was realised on the
// ephemeral runner, its shared libraries load, and the container sandbox
// flags work — failing here takes seconds with a clear root cause, where the
// same infra failure inside vitest browser mode surfaces as an opaque
// "browser disconnected" or a hang. Run with DEBUG=pw:browser for launch
// diagnostics.
import { alignPlaywrightBrowsers } from "./align-playwright-browsers.ts";

alignPlaywrightBrowsers();

// Import after aligning so no resolution happens against a stale registry.
const { chromium } = await import("playwright");

const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu-sandbox",
    "--disable-gpu",
    "--no-zygote",
  ],
});
const page = await browser.newPage();
await page.setContent("<h1>ok</h1>");
console.log(await page.textContent("h1"));

// Fonts smoke test: a fontless container (no /etc/fonts, no FONTCONFIG_FILE)
// renders zero glyphs, silently producing textless Creevey screenshots.
// Rasterize text on a canvas and require lit pixels.
const litPixels = await page.evaluate(() => {
  const canvas = document.createElement("canvas");
  canvas.width = 200;
  canvas.height = 50;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 200, 50);
  ctx.fillStyle = "#fff";
  ctx.font = "32px sans-serif";
  ctx.fillText("Aa gg 123", 10, 38);
  const { data } = ctx.getImageData(0, 0, 200, 50);
  let lit = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] > 128) lit++;
  return lit;
});
console.log(`font smoke test: ${litPixels} lit pixels`);
if (litPixels < 50) {
  throw new Error(
    `Font rendering check failed (${litPixels} lit pixels) — no usable fonts; check FONTCONFIG_FILE / devenv fonts`,
  );
}
await browser.close();
