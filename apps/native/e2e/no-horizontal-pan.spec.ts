import { expect, test } from "@playwright/test";

/**
 * Regression: the document itself must never pan horizontally. The main
 * window is a fixed-width app surface rendered in a transparent WKWebView —
 * if the root scroller is scrollable (or bounceable), a touchpad swipe
 * slides the whole UI sideways and exposes the window backing behind it.
 * Guarded by `overflow: clip` + `overscroll-behavior: none` on html/body/#root
 * in index.css; only inner containers (step content, console) may scroll.
 */
test.describe("document never pans horizontally", () => {
  // Minimum window size enforced in Rust — the main window is built with
  // `.min_inner_size(800.0, 600.0)` in src-tauri/src/main.rs (tauri.conf.json
  // has no windows block). This is the tightest layout the app can be shown
  // at, and where overflow would appear first.
  test.use({ viewport: { width: 800, height: 600 } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#root")).not.toBeEmpty();
  });

  test("root scroller rejects horizontal scrolling", async ({ page }) => {
    const result = await page.evaluate(() => {
      const doc = document.documentElement;
      // With `overflow: clip` the document is not a scroll container at all,
      // so even programmatic scrolls must be ignored.
      doc.scrollLeft = 100;
      document.body.scrollLeft = 100;
      return {
        htmlScrollLeft: doc.scrollLeft,
        bodyScrollLeft: document.body.scrollLeft,
        htmlOverflow: getComputedStyle(doc).overflow,
        htmlOverscroll: getComputedStyle(doc).overscrollBehavior,
      };
    });

    expect(result.htmlScrollLeft).toBe(0);
    expect(result.bodyScrollLeft).toBe(0);
    expect(result.htmlOverflow).toBe("clip");
    expect(result.htmlOverscroll).toBe("none");

    // The guard rule is deliberately unlayered so it outranks Tailwind's
    // @layer utilities. Prove the precedence: a utilities-layer override —
    // what a stray `overflow-auto` on html would compile to — must lose.
    const withLayeredOverride = await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = "@layer utilities { html { overflow: auto; } }";
      document.head.append(style);
      const overflow = getComputedStyle(document.documentElement).overflow;
      style.remove();
      return overflow;
    });
    expect(withLayeredOverride).toBe("clip");

    // Simulated horizontal touchpad pan must not move the document either.
    await page.mouse.move(400, 300);
    await page.mouse.wheel(300, 0);
    await page.waitForTimeout(100);
    const scrollLeftAfterPan = await page.evaluate(
      () => document.documentElement.scrollLeft + document.body.scrollLeft,
    );
    expect(scrollLeftAfterPan).toBe(0);
  });

  test("no element extends past the viewport at minimum window width", async ({ page }) => {
    const offenders = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll("*"))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // Fixed-position chrome (drag regions, portals) is allowed to hug the
        // edges; it never contributes to scrollable overflow.
        if (getComputedStyle(el).position === "fixed") continue;
        if (r.right > window.innerWidth + 1 || r.left < -1) {
          out.push(
            `<${el.tagName.toLowerCase()} class="${el.getAttribute("class") ?? ""}"> ` +
              `[${Math.round(r.left)}, ${Math.round(r.right)}]`,
          );
        }
      }
      return out;
    });

    expect(offenders).toEqual([]);
  });
});
