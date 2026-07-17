import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ModelCombobox } from "@/components/widget/controls/model-combobox";

// Generic combobox behavior (filtering, committing, key handling) is covered
// by packages/ui combobox.test.tsx; this suite covers the model-loading glue.

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetCached = vi.fn<(provider: string) => Promise<string[]>>();
const mockSetCached = vi.fn<(provider: string, models: string[]) => Promise<void>>();
const mockGetPrefs = vi.fn<() => Promise<Record<string, string>>>();

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    models: {
      getCached: (provider: string) => mockGetCached(provider),
      setCached: (provider: string, models: string[]) => mockSetCached(provider, models),
      clearCached: vi.fn(),
    },
    ui: { getPrefs: () => mockGetPrefs() },
    cli: { listModels: vi.fn(async () => []) },
  },
}));

const MODELS = ["model-a", "model-b", "model-c"];

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface HarnessProps {
  initial?: string;
  provider?: "openrouter" | "ollama";
  defaultModel?: string;
}

function Harness({ initial = "", provider = "openrouter", defaultModel = "" }: HarnessProps) {
  const [value, setValue] = useState(initial);
  return (
    <ModelCombobox
      provider={provider}
      defaultModel={defaultModel}
      value={value}
      onChange={setValue}
      placeholder="Pick a model"
    />
  );
}

function input() {
  return screen.getByRole("combobox") as HTMLInputElement;
}

/** Settle the async model preload/refresh so state updates stay inside act. */
function flushLoads() {
  return act(async () => {});
}

async function openList() {
  fireEvent.mouseDown(input());
  fireEvent.focus(input());
  const options = await screen.findAllByRole("option");
  await flushLoads();
  return options;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(() => {
  // jsdom has no layout: cmdk scrolls the highlighted item into view and the
  // cmdk list observes its own size.
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

beforeEach(() => {
  mockGetCached.mockReset().mockResolvedValue(MODELS);
  mockSetCached.mockReset().mockResolvedValue();
  mockGetPrefs.mockReset().mockResolvedValue({});
  // Fresh-fetch path (openrouter hits the network); mirror the cache so the
  // "unchanged list" equality guard is exercised too.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: MODELS.map((id) => ({ id })) }),
    })),
  );
});

// ---------------------------------------------------------------------------
// Model-loading glue
// ---------------------------------------------------------------------------

describe("ModelCombobox", () => {
  it("lists the provider models with a default row naming the default model", async () => {
    render(<Harness initial="model-b" defaultModel="model-a" />);

    const options = await openList();

    expect(options.map((o) => o.textContent)).toEqual(["Default: model-a", ...MODELS]);
  });

  it("hides the default row for providers that require an explicit model", async () => {
    render(<Harness initial="model-b" provider="ollama" />);

    const options = await openList();

    expect(options.map((o) => o.textContent)).toEqual(MODELS);
  });

  it("regression: a provider change after an open starts a single load, not a duplicate", async () => {
    const { rerender } = render(<Harness initial="model-b" />);

    // Open once so the refresh path is armed (refreshTick > 0)
    await openList();
    fireEvent.keyDown(input(), { key: "Escape" });

    mockGetCached.mockClear();
    rerender(<Harness initial="model-b" provider="ollama" />);
    await flushLoads();

    expect(mockGetCached).toHaveBeenCalledExactlyOnceWith("ollama");
  });

  it("regression: keeps the loaded models across close/reopen instead of clearing", async () => {
    render(<Harness initial="model-b" />);

    await openList();
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    // Make the refresh hang: the list must still show the previous models
    mockGetCached.mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    fireEvent.mouseDown(input());
    expect(screen.getAllByRole("option", { name: /model-/ })).toHaveLength(MODELS.length);
  });
});
