import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSaveHost, widgetState } = vi.hoisted(() => ({
  mockSaveHost: vi.fn<(host: string) => Promise<void>>(),
  widgetState: {
    configDir: "",
    hosts: [] as string[],
    host: "",
    error: null as string | null,
  },
}));

vi.mock("@/stores/widget-store", () => ({
  useWidgetStore: <T,>(selector: (state: typeof widgetState) => T) =>
    selector(widgetState),
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

describe("<SetupStep>", () => {
  beforeEach(() => {
    widgetState.configDir = "";
    widgetState.hosts = [];
    widgetState.host = "";
    widgetState.error = null;
    mockSaveHost.mockReset();
    mockSaveHost.mockResolvedValue();
  });

  it("persists the displayed host when Next is clicked without changing the dropdown", async () => {
    widgetState.configDir = "/Users/me/.nixmac";
    widgetState.hosts = ["mbp"];
    widgetState.host = "mbp";

    render(<SetupStep />);

    const next = await screen.findByRole("button", { name: "Next" });
    fireEvent.click(next);

    await waitFor(() => expect(mockSaveHost).toHaveBeenCalledWith("mbp"));
    expect(mockSaveHost).not.toHaveBeenCalledWith("");
  });

  it("does not show Next while waiting to create a default configuration", async () => {
    widgetState.configDir = "/Users/me/.nixmac";
    widgetState.hosts = [];
    widgetState.host = "";

    render(<SetupStep />);
    fireEvent.click(screen.getByTestId("directory-picker"));

    expect(await screen.findByTestId("bootstrap-config")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });
});
