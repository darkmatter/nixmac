import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

type HomebrewInstall = {
  installed: boolean | null;
  installing: boolean;
  installPhase: string | null;
  lastError: string | null;
};

const { mockCheckHomebrew, mockInstallHomebrew, mockSetSkipped, viewModelState } = vi.hoisted(
  () => ({
    mockCheckHomebrew: vi.fn<() => Promise<void>>(),
    mockInstallHomebrew: vi.fn<() => Promise<void>>(),
    mockSetSkipped: vi.fn<(skipped: boolean) => void>(),
    viewModelState: {
      homebrewInstall: {
        installed: false,
        installing: false,
        installPhase: null,
        lastError: null,
      } as HomebrewInstall | null,
      homebrewLog: [] as string[],
    },
  }),
);

vi.mock("@nixmac/state", () => ({
  useViewModel: <T,>(selector: (state: typeof viewModelState) => T) => selector(viewModelState),
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

/** Replace the mirrored cell wholesale, as a backend event would. */
function setCell(next: Partial<HomebrewInstall> | null) {
  viewModelState.homebrewInstall =
    next === null
      ? null
      : { installed: false, installing: false, installPhase: null, lastError: null, ...next };
}

describe("<HomebrewSetupStep>", () => {
  beforeEach(() => {
    setCell({});
    viewModelState.homebrewLog = [];
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

  it("starts the guided install when the user installs", () => {
    render(<HomebrewSetupStep />);

    fireEvent.click(screen.getByRole("button", { name: /Install Homebrew/i }));

    expect(mockInstallHomebrew).toHaveBeenCalledTimes(1);
  });

  it("checks for Homebrew when status is pending", async () => {
    setCell({ installed: null });

    render(<HomebrewSetupStep />);

    expect(screen.getByText(/Checking for Homebrew/i)).toBeInTheDocument();
    await waitFor(() => expect(mockCheckHomebrew).toHaveBeenCalledTimes(1));
  });

  it("checks for Homebrew before the cell has hydrated", async () => {
    setCell(null);

    render(<HomebrewSetupStep />);

    expect(screen.getByText(/Checking for Homebrew/i)).toBeInTheDocument();
    await waitFor(() => expect(mockCheckHomebrew).toHaveBeenCalledTimes(1));
  });

  it("confirms when Homebrew is already installed", () => {
    setCell({ installed: true });

    render(<HomebrewSetupStep />);

    expect(screen.getByText(/Homebrew is installed/i)).toBeInTheDocument();
  });

  it("shows progress and streamed output while installing", () => {
    setCell({ installing: true });
    viewModelState.homebrewLog = ["==> Downloading Homebrew"];

    render(<HomebrewSetupStep />);

    expect(screen.getByText(/Installing Homebrew/i)).toBeInTheDocument();
    expect(screen.getByText(/==> Downloading Homebrew/)).toBeInTheDocument();
  });

  it("names the Command Line Tools wait, which is the slowest phase", () => {
    setCell({ installing: true, installPhase: "command-line-tools" });

    render(<HomebrewSetupStep />);

    expect(screen.getByText(/Waiting for the macOS Command Line Tools/i)).toBeInTheDocument();
  });

  // The CLT wait can sit on an Apple dialog for up to 45 minutes; without this
  // the only way out of the step is force-quitting the app.
  it("keeps Skip reachable while an install is running", () => {
    setCell({ installing: true });

    render(<HomebrewSetupStep />);

    expect(screen.getByRole("button", { name: /Skip for now/i })).toBeInTheDocument();
  });

  // The dead end this step used to reach: the installer exits 0, `brew` is
  // still undetectable, and the success screen renders with no way forward
  // while the onboarding gate keeps blocking.
  it("stays actionable when an install reports success but brew is undetectable", () => {
    setCell({ installed: false, lastError: "The installer finished, but Homebrew..." });

    render(<HomebrewSetupStep />);

    expect(screen.queryByText(/Homebrew is installed/i)).not.toBeInTheDocument();
    expect(screen.getByText(/The installer finished, but Homebrew/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Skip for now/i })).toBeInTheDocument();
  });

  // "Not installed, nothing went wrong" is the ordinary state, and must read
  // as an offer rather than a failure.
  it("shows the offer, not an error, when no run has failed", () => {
    setCell({ installed: false, lastError: null });

    render(<HomebrewSetupStep />);

    expect(screen.getByText(/Homebrew was not found on this Mac/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Install Homebrew/i })).toBeInTheDocument();
  });
});
