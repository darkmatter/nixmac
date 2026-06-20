import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GitStatus } from "@/ipc/types";
import { useViewModel } from "@/stores/view-model";
import { makeGlobalPreferences } from "@/utils/test-fixtures";

const { mockFlakeExistsAt, mockSaveHost } = vi.hoisted(() => ({
  mockFlakeExistsAt: vi.fn<(dir: string) => Promise<boolean>>(),
  mockSaveHost: vi.fn<(host: string) => Promise<void>>(),
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    flake: {
      existsAt: mockFlakeExistsAt,
    },
  },
}));

vi.mock("@/hooks/use-darwin-config", () => ({
  useDarwinConfig: () => ({
    saveHost: mockSaveHost,
  }),
}));

vi.mock("@/components/widget/controls/directory-picker", () => ({
  DirectoryPicker: ({ onConfigured }: { onConfigured?: () => void }) => (
    <button type="button" data-testid="directory-picker" onClick={() => onConfigured?.()}>
      Configure directory
    </button>
  ),
}));

vi.mock("@/components/widget/controls/bootstrap-config", () => ({
  BootstrapConfig: ({ showLabel = true }: { showLabel?: boolean }) => (
    <div data-testid="bootstrap-config" data-show-label={String(showLabel)}>
      Make initial commit
    </div>
  ),
}));

import { SetupStep } from "./setup-step";

function seedConfig(configDir: string | null, hosts: string[], host: string | null) {
  useViewModel.setState({
    preferences: makeGlobalPreferences({ configDir, hostAttr: host }),
    hosts,
  });
}

describe("<SetupStep>", () => {
  beforeEach(() => {
    seedConfig(null, [], null);
    useViewModel.setState({ git: { headCommitHash: "abc123" } as GitStatus });
    mockFlakeExistsAt.mockReset();
    mockFlakeExistsAt.mockResolvedValue(true);
    mockSaveHost.mockReset();
    mockSaveHost.mockResolvedValue();
  });

  it("persists the displayed host when Next is clicked without changing the dropdown", async () => {
    seedConfig("/Users/me/.nixmac", ["mbp"], "mbp");

    render(<SetupStep />);

    const next = await screen.findByRole("button", { name: "Next" });
    fireEvent.click(next);

    await waitFor(() => expect(mockSaveHost).toHaveBeenCalledWith("mbp"));
    expect(mockSaveHost).not.toHaveBeenCalledWith("");
  });

  it("does not show Next while waiting to create a default configuration", async () => {
    seedConfig("/Users/me/.nixmac", [], null);

    render(<SetupStep />);
    fireEvent.click(screen.getByTestId("directory-picker"));

    expect(await screen.findByTestId("bootstrap-config")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });

  it("does not show Next or initial commit before a host is filled", () => {
    seedConfig("/Users/me/.nixmac", ["mbp", "mini"], "");

    render(<SetupStep />);

    expect(screen.queryByText("Make initial commit")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    expect(mockFlakeExistsAt).not.toHaveBeenCalled();
  });

  it("shows the initial commit UI instead of Next when a prefilled host has no initial commit", async () => {
    seedConfig("/Users/me/.nixmac", ["mbp", "mini"], "mbp");
    useViewModel.setState({ git: { headCommitHash: "" } as GitStatus });
    mockFlakeExistsAt.mockResolvedValue(true);

    render(<SetupStep />);

    expect(await screen.findByText("Make initial commit")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    expect(mockFlakeExistsAt).toHaveBeenCalledWith("/Users/me/.nixmac");
  });
});
