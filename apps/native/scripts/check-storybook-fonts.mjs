import { chromium } from "playwright";

const storybookUrl = process.env.STORYBOOK_URL ?? "http://127.0.0.1:6100";
// Each app font maps a Tailwind utility (`font-<kind>`) to the CSS @font-face
// family we ask the browser to load, and the internal family name Chromium
// reports once it actually rasterizes glyphs — the embedded (platform) name,
// which differs from the @font-face name (e.g. "Inter" vs "Inter Variable").
const fonts = [
  { kind: "sans", cssFamily: "Inter Variable", platformFamily: "Inter" },
  { kind: "mono", cssFamily: "Geist Mono Variable", platformFamily: "Geist Mono" },
];

const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu-sandbox",
    "--disable-gpu",
    "--no-zygote",
  ],
});

try {
  const indexResponse = await fetch(`${storybookUrl}/index.json`);
  if (!indexResponse.ok) {
    throw new Error(
      `Could not load Storybook index: ${indexResponse.status} ${indexResponse.statusText}`,
    );
  }

  const index = await indexResponse.json();
  const story = Object.values(index.entries).find((entry) => entry.type === "story");
  if (!story) {
    throw new Error("Storybook index contains no stories");
  }

  const page = await browser.newPage();
  await page.goto(`${storybookUrl}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`, {
    waitUntil: "networkidle",
  });
  await page.evaluate(async (appFonts) => {
    const text = "Aa gg 123 nixmac";

    for (const { kind } of appFonts) {
      const marker = document.createElement("span");
      marker.dataset.fontCheck = kind;
      marker.className = `font-${kind}`;
      marker.textContent = text;
      document.body.append(marker);
    }

    await Promise.all(
      appFonts.map(({ cssFamily }) => document.fonts.load(`16px "${cssFamily}"`, text)),
    );
    await document.fonts.ready;
  }, fonts);

  const client = await page.context().newCDPSession(page);
  await client.send("DOM.enable");
  await client.send("CSS.enable");
  const { root } = await client.send("DOM.getDocument");

  for (const { kind, platformFamily } of fonts) {
    const selector = `[data-font-check="${kind}"]`;
    const { nodeId } = await client.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    const { fonts: platformFonts } = await client.send("CSS.getPlatformFontsForNode", { nodeId });
    const renderedFamilies = platformFonts
      .filter((font) => font.glyphCount > 0)
      .map((font) => font.familyName);

    if (!renderedFamilies.includes(platformFamily)) {
      throw new Error(
        `${kind} font mismatch: expected ${platformFamily}, rendered ${renderedFamilies.join(", ") || "no font"}`,
      );
    }

    console.log(`${kind}: ${platformFamily}`);
  }
} finally {
  await browser.close();
}
