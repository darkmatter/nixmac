import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  once: vi.fn().mockResolvedValue(() => {}),
}));

afterEach(() => {
  cleanup();
});

if (!document.queryCommandSupported) {
  document.queryCommandSupported = () => false;
}

// jsdom's scrollTo throws "Not implemented"; TanStack Router calls it on
// navigation.
window.scrollTo = () => {};
