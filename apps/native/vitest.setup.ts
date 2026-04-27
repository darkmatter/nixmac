import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn<(event: string, handler: (...args: unknown[]) => void) => Promise<() => void>>(
    async () => () => {},
  ),
  once: vi.fn<(event: string, handler: (...args: unknown[]) => void) => Promise<() => void>>(
    async () => () => {},
  ),
}));

if (typeof document !== "undefined" && !document.queryCommandSupported) {
  Object.defineProperty(document, "queryCommandSupported", {
    configurable: true,
    value: () => false,
  });
}
