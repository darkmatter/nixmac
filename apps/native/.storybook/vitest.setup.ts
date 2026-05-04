import { afterEach, beforeAll, expect } from "vitest";
import { setProjectAnnotations } from "@storybook/react-vite";
import preview from "./preview";

const annotations = setProjectAnnotations([preview as any]);

beforeAll(annotations.beforeAll);

function normalizeAnimations(html: string): string {
  return html
    .replace(/translateY\(([^)]+)\)/g, (_match, val) => {
      const rounded = Math.round(Number.parseFloat(val));
      const stableOffset = rounded >= 9 && rounded <= 11 ? 10 : rounded;
      return `translateY(${stableOffset}px)`;
    })
    .replace(/translateX\(([^)]+)\)/g, (_match, val) => {
      return `translateX(${Math.round(Number.parseFloat(val))}px)`;
    })
    .replace(/scale\(([^)]+)\)/g, (_match, val) => {
      return `scale(${Math.round(Number.parseFloat(val) * 100) / 100})`;
    })
    .replace(/opacity:\s*([\d.]+)/g, (_match, val) => {
      return `opacity: ${Math.round(Number.parseFloat(val) * 100) / 100}`;
    });
}

/**
 * Normalize volatile runtime-generated DOM so story snapshots cover our
 * component chrome instead of Monaco's platform-specific implementation.
 */
function normalizeSnapshot(root: Element): string {
  const clone = root.cloneNode(true) as Element;

  clone.querySelectorAll(".monaco-editor").forEach((editor) => {
    const wrapper = document.createElement("div");
    wrapper.className = "monaco-editor-snapshot";
    wrapper.setAttribute("data-mode-id", editor.closest("[data-mode-id]")?.getAttribute("data-mode-id") ?? "");
    editor.replaceWith(wrapper);
  });

  return normalizeAnimations(clone.innerHTML);
}

// Automatically snapshot every story after it renders
afterEach(() => {
  const containers = document.body.querySelectorAll(
    ":scope > div:not(.sb-wrapper)"
  );
  const root = containers[containers.length - 1];
  if (root?.innerHTML) {
    expect(normalizeSnapshot(root)).toMatchSnapshot();
  }
});
