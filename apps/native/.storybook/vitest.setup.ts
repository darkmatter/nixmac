import { afterEach, beforeAll, expect } from "vitest";
import { setProjectAnnotations } from "@storybook/react-vite";
import preview from "./preview";

const annotations = setProjectAnnotations([preview as any]);

beforeAll(annotations.beforeAll);

/**
 * Normalize non-deterministic animation values in rendered HTML
 * so snapshots remain stable across runs.
 */
function normalizeAnimations(html: string): string {
  return html
    .replace(/translateY\(([^)]+)\)/g, (_match, val) => {
      return `translateY(${Math.round(Number.parseFloat(val))}px)`;
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

// Automatically snapshot every story after it renders
afterEach(() => {
  const containers = document.body.querySelectorAll(
    ":scope > div:not(.sb-wrapper)"
  );
  const root = containers[containers.length - 1];
  if (root?.innerHTML) {
    expect(normalizeAnimations(root.innerHTML)).toMatchSnapshot();
  }
});
