import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWidgetStore } from "@/stores/widget-store";
import { DirectoryPicker } from "@/components/widget/controls/directory-picker";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPickDir = vi.fn();
const mockNormalize = vi.fn<(p: string) => Promise<string | null>>();
const mockExists = vi.fn<(p: string) => Promise<boolean>>();
const mockSetDir =
  vi.fn<(p: string) => Promise<{ dir: string; evolveState: never; hosts: string[] | null }>>();
const mockSetHostAttr = vi.fn<(h: string) => Promise<void>>();
const mockFlakeExistsAt = vi.fn<(p: string) => Promise<boolean>>();
const mockFlakeExists = vi.fn<() => Promise<boolean>>();

vi.mock("@/tauri-api", () => ({
  darwinAPI: {
    path: {
      normalize: (p: string) => mockNormalize(p),
      exists: (p: string) => mockExists(p),
    },
    config: {
      setDir: (p: string) => mockSetDir(p),
      pickDir: () => mockPickDir(),
      setHostAttr: (h: string) => mockSetHostAttr(h),
    },
    flake: {
      existsAt: (p: string) => mockFlakeExistsAt(p),
      exists: () => mockFlakeExists(),
    },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  const s = useWidgetStore.getState();
  s.setConfigDir("");
  s.setHost("");
  s.setHosts([]);
  s.setBootstrapping(false);
}

function resetMocks() {
  mockPickDir.mockReset();
  mockNormalize.mockReset();
  mockExists.mockReset();
  mockSetDir.mockReset();
  mockSetHostAttr.mockReset();
  mockFlakeExistsAt.mockReset();
  mockFlakeExists.mockReset();

  // Sensible "happy-path" defaults; individual tests override as needed.
  mockNormalize.mockImplementation(async (p) => p.trim());
  mockExists.mockResolvedValue(true);
  mockSetDir.mockImplementation(async (p) => ({
    dir: p,
    evolveState: {} as never,
    hosts: [],
  }));
  mockSetHostAttr.mockResolvedValue();
  mockFlakeExistsAt.mockResolvedValue(true);
  mockFlakeExists.mockResolvedValue(true);
  mockPickDir.mockResolvedValue(null);
}

/** Type into the input then fire a blur event. Mirrors `userEvent.type` + tab-out
 *  without requiring the `@testing-library/user-event` package (not installed). */
function typeAndBlur(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("<DirectoryPicker>", () => {
  beforeEach(() => {
    resetMocks();
    resetStore();
  });

  afterEach(() => {
    resetStore();
  });

  it("renders the label, sublabel, and initial value from the store", () => {
    useWidgetStore.getState().setConfigDir("/Users/me/.darwin");
    render(<DirectoryPicker label="Config directory" subLabel="flake root" />);

    expect(screen.getByText("Config directory")).toBeInTheDocument();
    expect(screen.getByText("(flake root)")).toBeInTheDocument();
    const input = screen.getByLabelText("Config directory") as HTMLInputElement;
    expect(input.value).toBe("/Users/me/.darwin");
  });

  it("shows 'Directory path is required' when the input is blurred empty", async () => {
    render(<DirectoryPicker label="Config directory" />);
    const input = screen.getByLabelText("Config directory");
    fireEvent.blur(input);

    expect(await screen.findByText("Directory path is required")).toBeInTheDocument();
    expect(mockNormalize).not.toHaveBeenCalled();
    expect(mockSetDir).not.toHaveBeenCalled();
  });

  it("shows a non-existence error and does NOT update the store when the dir is missing", async () => {
    mockExists.mockResolvedValue(false);

    render(<DirectoryPicker label="Config directory" />);
    const input = screen.getByLabelText("Config directory");
    typeAndBlur(input, "/does/not/exist");

    expect(
      await screen.findByText(/directory does not exist: \/does\/not\/exist/i),
    ).toBeInTheDocument();

    expect(mockSetDir).not.toHaveBeenCalled();
    expect(useWidgetStore.getState().configDir).toBe("");
  });

  it("on a valid path, normalizes, persists, clears host, and refreshes the hosts list", async () => {
    mockNormalize.mockResolvedValue("/Users/me/.darwin");
    mockSetDir.mockResolvedValue({
      dir: "/Users/me/.darwin",
      evolveState: {} as never,
      hosts: ["mbp", "workbook"],
    });
    useWidgetStore.getState().setHost("old-host");

    render(<DirectoryPicker label="Config directory" />);
    typeAndBlur(screen.getByLabelText("Config directory"), "  /Users/me/.darwin  ");

    await waitFor(() => {
      expect(mockSetDir).toHaveBeenCalledWith("/Users/me/.darwin");
    });
    // Allow all chained awaits in onBlur to settle.
    await screen.findByDisplayValue("/Users/me/.darwin");

    // Input is trimmed before being passed to `darwinAPI.path.normalize`.
    expect(mockNormalize).toHaveBeenCalledWith("/Users/me/.darwin");
    expect(mockExists).toHaveBeenCalledWith("/Users/me/.darwin");
    expect(mockSetDir).toHaveBeenCalledWith("/Users/me/.darwin");
    expect(mockSetHostAttr).toHaveBeenCalledWith("");

    const s = useWidgetStore.getState();
    expect(s.configDir).toBe("/Users/me/.darwin");
    expect(s.host).toBe("");
    expect(s.hosts).toEqual(["mbp", "workbook"]);
  });

  it("uses empty hosts when setDir has no hosts and still persists the dir", async () => {
    mockNormalize.mockResolvedValue("/Users/me/.darwin");
    mockSetDir.mockResolvedValue({
      dir: "/Users/me/.darwin",
      evolveState: {} as never,
      hosts: null,
    });

    render(<DirectoryPicker label="Config directory" />);
    typeAndBlur(screen.getByLabelText("Config directory"), "/Users/me/.darwin");

    await waitFor(() => {
      expect(mockSetDir).toHaveBeenCalledWith("/Users/me/.darwin");
    });
    expect(useWidgetStore.getState().configDir).toBe("/Users/me/.darwin");
    expect(useWidgetStore.getState().hosts).toEqual([]);
  });

  it("ignores setHostAttr failures without breaking the happy path", async () => {
    mockNormalize.mockResolvedValue("/Users/me/.darwin");
    mockSetHostAttr.mockRejectedValue(new Error("host-attr persist failed"));
    mockSetDir.mockResolvedValue({
      dir: "/Users/me/.darwin",
      evolveState: {} as never,
      hosts: ["mbp"],
    });
    mockListHosts.mockResolvedValue(["mbp"]);

    render(<DirectoryPicker label="Config directory" />);
    typeAndBlur(screen.getByLabelText("Config directory"), "/Users/me/.darwin");

    await waitFor(() => {
      expect(useWidgetStore.getState().configDir).toBe("/Users/me/.darwin");
    });

    expect(useWidgetStore.getState().configDir).toBe("/Users/me/.darwin");
    expect(useWidgetStore.getState().hosts).toEqual(["mbp"]);
  });

  it("surfaces setDir errors as a validation message", async () => {
    mockNormalize.mockResolvedValue("/Users/me/.darwin");
    mockSetDir.mockRejectedValue(new Error("permission denied"));

    render(<DirectoryPicker label="Config directory" />);
    typeAndBlur(screen.getByLabelText("Config directory"), "/Users/me/.darwin");

    expect(await screen.findByText("permission denied")).toBeInTheDocument();
    // Store should not be updated if setDir threw.
    expect(useWidgetStore.getState().configDir).toBe("");
  });

  it("invokes useDarwinConfig().pickDir when the Browse button is clicked", () => {
    render(<DirectoryPicker label="Config directory" />);
    fireEvent.click(screen.getByRole("button", { name: /browse/i }));
    expect(mockPickDir).toHaveBeenCalledTimes(1);
  });

  it("clears the validation message when configDir changes externally to a valid dir with a flake", async () => {
    mockFlakeExistsAt.mockResolvedValue(true);

    render(<DirectoryPicker label="Config directory" />);

    // External store change (e.g. via the native Browse dialog):
    act(() => {
      useWidgetStore.getState().setConfigDir("/Users/me/.darwin");
    });

    // Wait for the effect's async chain to resolve. If a validation message appeared,
    // it should NOT be present for a valid flake dir.
    const input = await screen.findByDisplayValue("/Users/me/.darwin");
    expect(input).toBeInTheDocument();
    expect(mockExists).toHaveBeenCalledWith("/Users/me/.darwin");
    expect(mockFlakeExistsAt).toHaveBeenCalledWith("/Users/me/.darwin");
    expect(screen.queryByText(/flake\.nix not found/i)).not.toBeInTheDocument();
  });

  it("flags 'flake.nix not found' when an externally-set dir exists but has no flake", async () => {
    mockExists.mockResolvedValue(true);
    mockFlakeExistsAt.mockResolvedValue(false);

    render(<DirectoryPicker label="Config directory" />);

    act(() => {
      useWidgetStore.getState().setConfigDir("/Users/me/empty");
    });

    expect(
      await screen.findByText(/flake\.nix not found in this directory/i),
    ).toBeInTheDocument();
  });
});
