import { afterEach, beforeAll, expect } from "vitest";
import preview from "./preview";

beforeAll(preview.composed.beforeAll);

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

function normalizeSnapshotRoot(root: Element): string {
  const clone = root.cloneNode(true) as Element;

  for (const editor of clone.querySelectorAll('[data-slot="nix-editor"]')) {
    editor.replaceChildren();
    const placeholder = document.createElement("div");
    placeholder.setAttribute("data-slot", "nix-editor-placeholder");
    editor.appendChild(placeholder);
  }

  let html = normalizeAnimations(clone.innerHTML);
  // Monaco assigns auto-incrementing model IDs that vary by test-suite order.
  html = html.replace(/inmemory:\/\/model\/\d+/g, "inmemory://model/N");
  // data-keybinding-context values are similarly auto-incremented.
  html = html.replace(/data-keybinding-context="\d+"/g, 'data-keybinding-context="N"');
  return html;
}

// Automatically snapshot every story after it renders
afterEach(() => {
  const containers = document.body.querySelectorAll(
    ":scope > div:not(.sb-wrapper)"
  );
  const root = containers[containers.length - 1];
  if (root?.innerHTML) {
    expect(normalizeSnapshotRoot(root)).toMatchSnapshot();
  }
});
