import { afterEach, beforeAll, expect } from "vitest";

type MonacoEnvironment = {
  getWorker: (workerId: string, label: string) => Worker;
};

declare global {
  interface Window {
    MonacoEnvironment?: MonacoEnvironment;
  }
}

window.MonacoEnvironment = {
  getWorker(_workerId, label) {
    const workerUrl = label === "json"
      ? new URL("monaco-editor/esm/vs/language/json/json.worker.js", import.meta.url)
      : new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url);

    return new Worker(workerUrl, { type: "module" });
  },
};

const preview = await import("./preview");

beforeAll(preview.default.composed.beforeAll);

function normalizeAnimations(html: string): string {
  return html
    .replace(/transform:\s*[^;"]+/g, "transform: MOTION")
    .replace(/opacity:\s*[^;"]+/g, "opacity: MOTION")
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

  for (const mascot of clone.querySelectorAll('[aria-label="nixmac mascot"]')) {
    if (!mascot.classList.contains("nixmac-mascot")) {
      const placeholder = document.createElement("div");
      placeholder.setAttribute("aria-label", "nixmac mascot");
      placeholder.setAttribute("data-slot", "nixmac-mascot-lottie");

      const style = mascot.getAttribute("style");
      if (style) {
        placeholder.setAttribute("style", style);
      }

      mascot.replaceWith(placeholder);
    }
  }

  for (const editor of clone.querySelectorAll('[data-slot="nix-editor"]')) {
    editor.replaceChildren();
    const placeholder = document.createElement("div");
    placeholder.setAttribute("data-slot", "nix-editor-placeholder");
    editor.appendChild(placeholder);
  }

  for (const editor of clone.querySelectorAll(".monaco-diff-editor, .monaco-editor")) {
    editor.replaceChildren();
    const style = editor.getAttribute("style");
    if (style) {
      editor.setAttribute(
        "style",
        style
          .replace(/width:\s*[^;"]+/g, "width: MONACO")
          .replace(/height:\s*[^;"]+/g, "height: MONACO")
      );
    }

    const placeholder = document.createElement("div");
    placeholder.setAttribute("data-slot", "monaco-editor-placeholder");
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
