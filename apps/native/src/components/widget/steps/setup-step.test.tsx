import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useViewModel } from "@/stores/view-model";
import { makeGlobalPreferences } from "@/utils/test-fixtures";

const { mockSaveHost } = vi.hoisted(() => ({
const { mockFlakeExistsAt, mockSaveHost, viewModelState, widgetState } = vi.hoisted(() => ({
  mockFlakeExistsAt: vi.fn<(dir: string) => Promise<boolean>>(),
  mockSaveHost: vi.fn<(host: string) => Promise<void>>(),
  viewModelState: {
    git: {
      headCommitHash: "abc123",
    } as { headCommitHash: string | null } | null,
  },
}));

vi.mock("@/stores/view-model", () => ({
  useViewModel: <T,>(selector: (state: typeof viewModelState) => T) =>
    selector(viewModelState),
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

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    onValueChange,
    value,
  }: {
    children: React.ReactNode;
    onValueChange?: (value: string) => void;
    value?: string;
  }) => (
    <select
      aria-label="host-select"
      value={value ?? ""}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{value}</option>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder: string }) => (
    <option value="">{placeholder}</option>
  ),
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
    viewModelState.git = { headCommitHash: "abc123" };
    mockFlakeExistsAt.mockReset();
    mockFlakeExistsAt.mockResolvedValue(true);
    mockSaveHost.mockReset();
    mockSaveHost.mockResolvedValue();
  });

  it("uses a prefilled host when showing Next", async () => {
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
    widgetState.configDir = "/Users/me/.nixmac";
    widgetState.hosts = ["mbp", "mini"];
    widgetState.host = "";

    render(<SetupStep />);

    expect(screen.queryByText("Make initial commit")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    expect(mockFlakeExistsAt).not.toHaveBeenCalled();
  });

  it("shows the initial commit UI instead of Next when a prefilled host has no initial commit", async () => {
    widgetState.configDir = "/Users/me/.nixmac";
    widgetState.hosts = ["mbp", "mini"];
    widgetState.host = "mbp";
    viewModelState.git = { headCommitHash: "" };
    mockFlakeExistsAt.mockResolvedValue(true);

    render(<SetupStep />);

    expect(await screen.findByText("Make initial commit")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    expect(mockFlakeExistsAt).toHaveBeenCalledWith("/Users/me/.nixmac");
  });
});
