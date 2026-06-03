import { afterEach, beforeAll, expect } from "vitest";
import preview from "./preview";

beforeAll(preview.composed.beforeAll);

function normalizeAnimations(html: string): string {
  return html
    .replace(/translateY\(([^)]+)\)/g, (_match, val) => {
      if (!Number.isFinite(Number.parseFloat(val))) {
        return `translateY(${val})`;
      }
      return "translateY(0px)";
    })
    .replace(/translateX\(([^)]+)\)/g, (_match, val) => {
      return `translateX(${Math.round(Number.parseFloat(val))}px)`;
    })
    .replace(/scale\(([^)]+)\)/g, (_match, val) => {
      if (!Number.isFinite(Number.parseFloat(val))) {
        return `scale(${val})`;
      }
      return "scale(1)";
    })
    .replace(/opacity:\s*([\d.]+)/g, (_match, val) => {
      if (!Number.isFinite(Number.parseFloat(val))) {
        return `opacity: ${val}`;
      }
      return "opacity: 0";
    })
    .replace(/transform:\s*(?:translateY\(0px\)|scale\(1\))/g, "transform: none");
}

function normalizeSnapshotRoot(root: Element): string {
  const clone = root.cloneNode(true) as Element;

  for (const editor of clone.querySelectorAll('[data-slot="nix-editor"]')) {
    editor.replaceChildren();
    const placeholder = document.createElement("div");
    placeholder.setAttribute("data-slot", "nix-editor-placeholder");
    editor.appendChild(placeholder);
  }

  for (const editor of clone.querySelectorAll(".monaco-diff-editor, .monaco-editor")) {
    editor.replaceChildren();
    const placeholder = document.createElement("div");
    placeholder.setAttribute("data-slot", "monaco-editor-placeholder");
    editor.appendChild(placeholder);
  }

  let html = normalizeAnimations(clone.innerHTML);
  // Monaco assigns auto-incrementing model IDs that vary by test-suite order.
  html = html.replace(/inmemory:\/\/model\/\d+/g, "inmemory://model/N");
  // data-keybinding-context values are similarly auto-incremented.
  html = html.replace(/data-keybinding-context="\d+"/g, 'data-keybinding-context="N"');
  html = html.replace(
    /<div style="width: 100%;" data-keybinding-context="N">/g,
    '<div data-keybinding-context="N" style="width: 100%;">'
  );
  // Monaco includes a platform class (`mac`, `linux`, `windows`) based on the runner.
  html = html.replace(
    /\bmonaco-editor no-user-select (?:mac|linux|windows)\s+/g,
    "monaco-editor no-user-select "
  );
  html = html.replace(
    /\bmonaco-editor no-user-select\s+/g,
    "monaco-editor no-user-select "
  );
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
