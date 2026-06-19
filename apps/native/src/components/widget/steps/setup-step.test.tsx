import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useViewModel } from "@/stores/view-model";
import { makeGlobalPreferences } from "@/utils/test-fixtures";

const { mockSaveHost } = vi.hoisted(() => ({
  mockSaveHost: vi.fn<(host: string) => Promise<void>>(),
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
  BootstrapConfig: () => <div data-testid="bootstrap-config" />,
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
});
