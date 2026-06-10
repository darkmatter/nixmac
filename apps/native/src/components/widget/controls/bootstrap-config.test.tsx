import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useViewModel } from "@/stores/view-model";
import { useWidgetStore } from "@/stores/widget-store";

const { mockBootstrap, mockDefaultHostname, mockFlakeExistsAt } = vi.hoisted(() => ({
  mockBootstrap: vi.fn<(hostname: string) => Promise<void>>(),
  mockDefaultHostname: vi.fn<() => Promise<string>>(),
  mockFlakeExistsAt: vi.fn<(dir: string) => Promise<boolean>>(),
}));

vi.mock("@/hooks/use-darwin-config", () => ({
  useDarwinConfig: () => ({
    bootstrap: mockBootstrap,
    isBootstrapping: false,
  }),
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    config: {
      defaultHostname: () => mockDefaultHostname(),
    },
    flake: {
      existsAt: (dir: string) => mockFlakeExistsAt(dir),
    },
  },
}));

import { BootstrapConfig } from "@/components/widget/controls/bootstrap-config";

function resetStores() {
  const widgetStore = useWidgetStore.getState();
  widgetStore.setConfigDir("");
  widgetStore.setError(null);
  widgetStore.setBootstrapping(false);
  useViewModel.setState({ git: null });
}

describe("<BootstrapConfig>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    mockBootstrap.mockResolvedValue();
    mockDefaultHostname.mockResolvedValue("test-macbook");
    mockFlakeExistsAt.mockResolvedValue(false);
  });

  it("pre-populates the hostname field with the current machine hostname", async () => {
    mockDefaultHostname.mockResolvedValue("Scotts-MacBook-Pro");

    render(<BootstrapConfig label="Configuration" />);

    expect(await screen.findByDisplayValue("Scotts-MacBook-Pro")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("macbook")).not.toBeInTheDocument();
  });

  it("keeps a user-entered override if hostname lookup resolves later", async () => {
    let resolveHostname: (hostname: string) => void = () => {};
    mockDefaultHostname.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHostname = resolve;
        }),
    );

    render(<BootstrapConfig label="Configuration" />);

    const input = screen.getByLabelText("Host name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "custom-host" } });

    await act(async () => {
      resolveHostname("resolved-host");
    });

    expect(input.value).toBe("custom-host");

    fireEvent.click(screen.getByRole("button", { name: /create default configuration/i }));
    await waitFor(() => expect(mockBootstrap).toHaveBeenCalledWith("custom-host"));
  });

  it("falls back to macbook when the hostname lookup fails", async () => {
    mockDefaultHostname.mockRejectedValue(new Error("hostname unavailable"));

    render(<BootstrapConfig label="Configuration" />);

    const input = screen.getByLabelText("Host name") as HTMLInputElement;
    await waitFor(() => expect(mockDefaultHostname).toHaveBeenCalled());
    expect(input.value).toBe("macbook");
    expect(screen.queryByText(/hostname unavailable/i)).not.toBeInTheDocument();
  });
});
