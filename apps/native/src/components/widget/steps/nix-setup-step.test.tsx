import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCheckNix, widgetState } = vi.hoisted(() => ({
  mockCheckNix: vi.fn<() => Promise<void>>(),
  widgetState: {
    nixInstalled: false as boolean | null,
    darwinRebuildAvailable: null as boolean | null,
  },
}));

vi.mock("@/stores/widget-store", () => ({
  useWidgetStore: <T,>(selector: (state: typeof widgetState) => T) => selector(widgetState),
}));

vi.mock("@/hooks/use-nix-install", () => ({
  useNixInstall: () => ({
    checkNix: mockCheckNix,
  }),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn<(url: string) => Promise<void>>(),
}));

import { NixSetupStep } from "./nix-setup-step";

describe("<NixSetupStep>", () => {
  beforeEach(() => {
    widgetState.nixInstalled = false;
    widgetState.darwinRebuildAvailable = null;
    mockCheckNix.mockReset();
    mockCheckNix.mockResolvedValue();
  });

  it("guides users to external Nix installers without running the installer", () => {
    render(<NixSetupStep />);

    expect(screen.getByText(/Nix is the package manager nixmac uses/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Determinate Systems installer/i })).toHaveAttribute(
      "href",
      "https://determinate.systems/nix-installer/",
    );
    expect(screen.getByRole("link", { name: /Official NixOS installer/i })).toHaveAttribute(
      "href",
      "https://nixos.org/download/",
    );
    expect(screen.queryByRole("button", { name: /Install Nix/i })).not.toBeInTheDocument();
  });

  it("explains missing nix-darwin without auto-installing when Nix is installed", () => {
    widgetState.nixInstalled = true;
    widgetState.darwinRebuildAvailable = false;

    render(<NixSetupStep />);

    expect(screen.getByText(/Nix is installed, but nixmac cannot find darwin-rebuild/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /nix-darwin instructions/i })).toHaveAttribute(
      "href",
      "https://github.com/LnL7/nix-darwin",
    );
    expect(screen.getByRole("button", { name: /I've installed nix-darwin - check again/i })).toBeInTheDocument();
  });

  it("checks detection again when the user clicks the recheck button", () => {
    render(<NixSetupStep />);

    fireEvent.click(screen.getByRole("button", { name: /I've installed Nix - check again/i }));

    expect(mockCheckNix).toHaveBeenCalledTimes(1);
  });

  it("checks the system when setup status is pending", async () => {
    widgetState.nixInstalled = null;

    render(<NixSetupStep />);

    expect(screen.getByText(/Checking system/i)).toBeInTheDocument();
    await waitFor(() => expect(mockCheckNix).toHaveBeenCalledTimes(1));
  });
});
