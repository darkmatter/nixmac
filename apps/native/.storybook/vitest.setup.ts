import { afterEach, beforeAll, expect } from "vitest";

// Marker so stories can tell they're running under the headless Vitest snapshot
// runner (this setup file is NOT loaded by the interactive Storybook dev
// server). Stories use it to disable interaction-only behaviour — e.g. the
// DarwinWidget controls' store→args subscription — that would otherwise race
// the async widget mount and make snapshots non-deterministic.
(globalThis as { __STORYBOOK_VITEST__?: boolean }).__STORYBOOK_VITEST__ = true;

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
    // Animated gradients (e.g. the evolve/processing shimmer) sweep their
    // `circle at <x>px <y>px` center every frame — stabilize the coordinates
    // (the swept x can go negative, hence the optional sign).
    .replace(/circle at -?[\d.]+px -?[\d.]+px/g, "circle at MOTIONpx MOTIONpx")
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
  // Monaco can emit these attributes in either order across runs.
  html = html.replace(
    /<div style="([^"]*)" data-keybinding-context="N">/g,
    '<div data-keybinding-context="N" style="$1">'
  );
  html = html.replace(/ style="--cmdk-list-height:[^"]*"/g, "");
  return html;
}

function cleanupMonacoAccessibilityContainers(): void {
  for (const container of document.body.querySelectorAll(
    ":scope > .monaco-alert, :scope > .monaco-status"
  )) {
    container.remove();
  }
}

// Automatically snapshot every story after it renders
afterEach(() => {
  try {
    const containers = document.body.querySelectorAll(
      ":scope > div:not(.sb-wrapper)"
    );
    const root = containers[containers.length - 1];
    if (root?.innerHTML) {
      expect(normalizeSnapshotRoot(root)).toMatchSnapshot();
    }
  } finally {
    cleanupMonacoAccessibilityContainers();
  }
});
