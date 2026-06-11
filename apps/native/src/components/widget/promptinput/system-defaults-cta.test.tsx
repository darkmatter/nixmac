import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mirrorEvolveState } from "@/viewmodel/evolve";
import { SystemDefaultsCTA } from "./system-defaults-cta";

const { scanDefaults } = vi.hoisted(() => ({
  scanDefaults: vi.fn<() => Promise<{
    defaults: ReturnType<typeof defaultSetting>[];
    totalScanned: number;
  }>>(),
}));

const storage = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    clear: () => storage.clear(),
    getItem: (key: string) => storage.get(key) ?? null,
    removeItem: (key: string) => storage.delete(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  },
});

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    scanner: {
      scanDefaults,
      applyDefaults: vi.fn<() => Promise<void>>(),
    },
  },
}));

const beginState = {
  evolutionId: null,
  currentChangesetId: null,
  committable: false,
  backupBranch: null,
  rollbackBranch: null,
  rollbackStorePath: null,
  rollbackChangesetId: null,
  step: "begin" as const,
};

function defaultSetting(index: number) {
  return {
    nixKey: `system.defaults.test.${index}`,
    label: `Setting ${index}`,
    category: "System Settings",
    currentValue: "true",
    defaultValue: "false",
  };
}

describe("SystemDefaultsCTA", () => {
  beforeEach(() => {
    scanDefaults.mockReset();
    localStorage.clear();
    mirrorEvolveState(beginState);
  });

  it("shows plural untracked settings copy without a warning icon", async () => {
    scanDefaults.mockResolvedValue({
      defaults: Array.from({ length: 8 }, (_, index) => defaultSetting(index)),
      totalScanned: 8,
    });

    const { container } = render(<SystemDefaultsCTA />);

    expect(await screen.findByText("8 untracked settings")).toBeInTheDocument();
    expect(container.querySelector(".lucide-triangle-alert")).not.toBeInTheDocument();
  });

  it("shows singular untracked setting copy", async () => {
    scanDefaults.mockResolvedValue({
      defaults: [defaultSetting(1)],
      totalScanned: 1,
    });

    render(<SystemDefaultsCTA />);

    expect(await screen.findByText("1 untracked setting")).toBeInTheDocument();
  });

  it("hides the indicator when there are no untracked settings", async () => {
    scanDefaults.mockResolvedValue({ defaults: [], totalScanned: 0 });

    render(<SystemDefaultsCTA />);

    await waitFor(() => expect(scanDefaults).toHaveBeenCalled());
    expect(screen.queryByTestId("managed-system-defaults-badge")).not.toBeInTheDocument();
  });
});
