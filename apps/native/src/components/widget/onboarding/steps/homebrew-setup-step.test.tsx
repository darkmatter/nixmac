import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCheckHomebrew, mockInstallHomebrew, mockSetSkipped, onboardingState } = vi.hoisted(
  () => ({
    mockCheckHomebrew: vi.fn<() => Promise<void>>(),
    mockInstallHomebrew: vi.fn<(opts?: unknown) => Promise<void>>(),
    mockSetSkipped: vi.fn<(skipped: boolean) => void>(),
    onboardingState: {
      homebrewInstalled: false as boolean | null,
    },
  }),
);

vi.mock("@nixmac/state", () => ({
  useOnboarding: <T,>(selector: (state: typeof onboardingState) => T) => selector(onboardingState),
  onboardingActions: {
    setHomebrewSkipped: (skipped: boolean) => mockSetSkipped(skipped),
  },
}));

vi.mock("@/hooks/use-homebrew-install", () => ({
  useHomebrewInstall: () => ({
    checkHomebrew: mockCheckHomebrew,
    installHomebrew: mockInstallHomebrew,
  }),
}));

import { HomebrewSetupStep } from "./homebrew-setup-step";

describe("<HomebrewSetupStep>", () => {
  beforeEach(() => {
    onboardingState.homebrewInstalled = false;
    mockCheckHomebrew.mockReset();
    mockCheckHomebrew.mockResolvedValue();
    mockInstallHomebrew.mockReset();
    mockInstallHomebrew.mockResolvedValue();
    mockSetSkipped.mockReset();
  });

  it("offers install and skip when Homebrew is missing, without auto-installing", () => {
    render(<HomebrewSetupStep />);

    expect(screen.getByText(/Homebrew was not found on this Mac/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Install Homebrew/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Skip for now/i })).toBeInTheDocument();
    expect(mockInstallHomebrew).not.toHaveBeenCalled();
  });

  it("skips the optional step when the user chooses to skip", () => {
    render(<HomebrewSetupStep />);

    fireEvent.click(screen.getByRole("button", { name: /Skip for now/i }));

    expect(mockSetSkipped).toHaveBeenCalledWith(true);
  });

  it("runs the guided install and shows progress when the user installs", () => {
    render(<HomebrewSetupStep />);

    fireEvent.click(screen.getByRole("button", { name: /Install Homebrew/i }));

    expect(mockInstallHomebrew).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Installing Homebrew/i)).toBeInTheDocument();
  });

  it("checks for Homebrew when status is pending", async () => {
    onboardingState.homebrewInstalled = null;

    render(<HomebrewSetupStep />);

    expect(screen.getByText(/Checking for Homebrew/i)).toBeInTheDocument();
    await waitFor(() => expect(mockCheckHomebrew).toHaveBeenCalledTimes(1));
  });

  it("confirms when Homebrew is already installed", () => {
    onboardingState.homebrewInstalled = true;

    render(<HomebrewSetupStep />);

    expect(screen.getByText(/Homebrew is installed/i)).toBeInTheDocument();
  });
});
