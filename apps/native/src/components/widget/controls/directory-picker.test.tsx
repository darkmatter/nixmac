import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWidgetStore } from "@/stores/widget-store";
import type { SetDirResult } from "@/types/shared";
import { DirectoryPicker } from "@/components/widget/controls/directory-picker";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPickDir = vi.fn();
const mockPrepareNewDir = vi.fn<(p: string) => Promise<void>>();

vi.mock("@/hooks/use-darwin-config", () => ({
  useDarwinConfig: () => ({
    pickDir: async () => {
      const result = await mockPickDir();
      if (result) {
        const { useWidgetStore } = await import("@/stores/widget-store");
        const store = useWidgetStore.getState();
        store.setConfigDir(result.dir);
        store.setHosts(result.hosts ?? []);
      }
      return result;
    },
    setDir: async (p: string) => {
      await mockSetDir(p);
      const { useWidgetStore } = await import("@/stores/widget-store");
      const store = useWidgetStore.getState();
      store.setConfigDir(p);
      store.setHost("");
      try {
        await mockSetHostAttr("");
      } catch {}
      try {
        const hosts = await mockListHosts();
        store.setHosts(hosts);
        return { dir: p, evolveState: null, hosts };
      } catch {
        store.setHosts([]);
        return { dir: p, evolveState: null, hosts: [] };
      }
    },
    prepareNewDir: async (p: string) => {
      await mockPrepareNewDir(p);
      const { useWidgetStore } = await import("@/stores/widget-store");
      const store = useWidgetStore.getState();
      store.setConfigDir(p);
      store.setHost("");
      store.setHosts([]);
      return { dir: p, evolveState: null, hosts: [] };
    },
  }),
}));

const mockNormalize = vi.fn<(p: string) => Promise<string | null>>();
const mockExists = vi.fn<(p: string) => Promise<boolean>>();
const mockSetDir = vi.fn<(p: string) => Promise<SetDirResult>>();
const mockSetHostAttr = vi.fn<(h: string) => Promise<void>>();
const mockListHosts = vi.fn<() => Promise<string[]>>();
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
      listHosts: () => mockListHosts(),
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
  mockPrepareNewDir.mockReset();
  mockNormalize.mockReset();
  mockExists.mockReset();
  mockSetDir.mockReset();
  mockSetHostAttr.mockReset();
  mockFlakeExistsAt.mockReset();
  mockFlakeExists.mockReset();

  // Sensible "happy-path" defaults; individual tests override as needed.
  mockNormalize.mockImplementation(async (p) => p.trim());
  mockPrepareNewDir.mockResolvedValue();
  mockExists.mockResolvedValue(true);
  mockSetDir.mockResolvedValue({
    dir: "/Users/me/.darwin",
    evolveState: {} as never,
    hosts: [],
  });
  mockSetHostAttr.mockResolvedValue();
  mockFlakeExistsAt.mockResolvedValue(true);
  mockFlakeExists.mockResolvedValue(true);
  mockPickDir.mockResolvedValue(null);
  mockListHosts.mockResolvedValue([]);
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
    mockExists.mockResolvedValue(true);
    mockSetDir.mockResolvedValue({
      dir: "/Users/me/.darwin",
      evolveState: {} as never,
      hosts: ["mbp", "workbook"],
    });
    mockListHosts.mockResolvedValue(["mbp", "workbook"]);
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
    expect(mockListHosts).toHaveBeenCalledTimes(1);

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

  it("in setup flow, starts with New/Existing choices and creates a named directory", async () => {
    const onConfigured = vi.fn();
    mockNormalize.mockImplementation(async (p) => p === "~/.nixmac" ? "/Users/me/.nixmac" : p.trim());

    render(<DirectoryPicker label="Config directory" flow="setup" onConfigured={onConfigured} />);

    expect(screen.getByRole("tab", { name: "New" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Existing" })).toBeInTheDocument();

    const nameInput = screen.getByLabelText("Config directory name");
    fireEvent.change(nameInput, { target: { value: ".nixmac" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => expect(mockPrepareNewDir).toHaveBeenCalledWith("/Users/me/.nixmac"));
    expect(useWidgetStore.getState().configDir).toBe("/Users/me/.nixmac");
    expect(onConfigured).toHaveBeenCalledTimes(1);
  });

  it("in setup flow, rejects path-like names for new directories", async () => {
    render(<DirectoryPicker label="Config directory" flow="setup" />);

    fireEvent.change(screen.getByLabelText("Config directory name"), {
      target: { value: "configs/darwin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(await screen.findByText("Use a directory name, not a path")).toBeInTheDocument();
    expect(mockPrepareNewDir).not.toHaveBeenCalled();
  });

  it("in setup flow, Existing keeps the browse-based selection path", async () => {
    const onConfigured = vi.fn();
    mockPickDir.mockResolvedValue({ dir: "/Users/me/config", evolveState: null, hosts: ["mbp"] });

    render(<DirectoryPicker label="Config directory" flow="setup" onConfigured={onConfigured} />);
    fireEvent.click(screen.getByRole("tab", { name: "Existing" }));
    fireEvent.click(await screen.findByRole("button", { name: /browse/i }));

    await waitFor(() => expect(mockPickDir).toHaveBeenCalledTimes(1));
    expect(useWidgetStore.getState().configDir).toBe("/Users/me/config");
    expect(onConfigured).toHaveBeenCalledTimes(1);
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
