import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ModelCombobox } from "@/components/widget/controls/model-combobox";

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
  onChangeSpy?: (value: string) => void;
}

function Harness({ initial = "", provider = "openrouter", defaultModel = "", onChangeSpy }: HarnessProps) {
  const [value, setValue] = useState(initial);
  return (
    <ModelCombobox
      provider={provider}
      defaultModel={defaultModel}
      value={value}
      onChange={(v) => {
        onChangeSpy?.(v);
        setValue(v);
      }}
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
// Interaction matrix
// ---------------------------------------------------------------------------

describe("ModelCombobox", () => {
  it("opens with the full unfiltered list and the current selection highlighted", async () => {
    render(<Harness initial="model-b" defaultModel="model-a" />);

    const options = await openList();

    // Full list (default row + all models), no filtering by the current value
    expect(options.map((o) => o.textContent)).toEqual([
      "Default: model-a",
      ...MODELS,
    ]);
    // The selected model is highlighted, not the first row
    expect(screen.getByRole("option", { name: "model-b" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("regression: Enter right after opening re-commits the current selection, not the default row", async () => {
    const onChangeSpy = vi.fn();
    render(<Harness initial="model-b" defaultModel="model-a" onChangeSpy={onChangeSpy} />);

    await openList();
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(onChangeSpy).toHaveBeenCalledWith("model-b");
    expect(onChangeSpy).not.toHaveBeenCalledWith("");
    expect(input()).toHaveValue("model-b");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("typing filters the list without committing; clicking a model commits it", async () => {
    const onChangeSpy = vi.fn();
    render(<Harness initial="model-b" onChangeSpy={onChangeSpy} />);

    await openList();
    fireEvent.change(input(), { target: { value: "model-a" } });

    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["model-a"]);

    fireEvent.click(screen.getByRole("option", { name: "model-a" }));

    expect(onChangeSpy).toHaveBeenCalledExactlyOnceWith("model-a");
    expect(input()).toHaveValue("model-a");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("offers typed text that matches no model as a custom row and commits it on select", async () => {
    const onChangeSpy = vi.fn();
    render(<Harness onChangeSpy={onChangeSpy} />);

    await openList();
    fireEvent.change(input(), { target: { value: "org/custom-model" } });

    const customRow = screen.getByRole("option", { name: 'Use "org/custom-model"' });
    fireEvent.click(customRow);

    expect(onChangeSpy).toHaveBeenCalledExactlyOnceWith("org/custom-model");
    expect(input()).toHaveValue("org/custom-model");
  });

  it("commits the empty string via the default row (meaning: use the provider default)", async () => {
    const onChangeSpy = vi.fn();
    render(<Harness initial="model-b" defaultModel="model-a" onChangeSpy={onChangeSpy} />);

    await openList();
    fireEvent.click(screen.getByRole("option", { name: "Default: model-a" }));

    expect(onChangeSpy).toHaveBeenCalledExactlyOnceWith("");
    expect(input()).toHaveValue("");
    expect(input()).toHaveAttribute("placeholder", "Pick a model");
  });

  it("hides the default row for providers that require an explicit model", async () => {
    render(<Harness initial="model-b" provider="ollama" />);

    const options = await openList();

    expect(options.map((o) => o.textContent)).toEqual(MODELS);
  });

  it("regression: keeps native key handling while the popover is closed, ArrowDown opens it", async () => {
    render(<Harness initial="model-b" />);
    await flushLoads();

    // Not swallowed by cmdk while closed (preventDefault would return false)
    expect(fireEvent.keyDown(input(), { key: "Home" })).toBe(true);
    expect(fireEvent.keyDown(input(), { key: "End" })).toBe(true);
    expect(fireEvent.keyDown(input(), { key: "Enter" })).toBe(true);

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
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
