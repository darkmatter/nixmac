import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { open } from "@tauri-apps/plugin-shell";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tauriAPI } from "@/ipc/api";
import { GeneralTab } from "./general-tab";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn<() => Promise<string>>().mockResolvedValue("0.0.0-test"),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock("@/components/widget/controls/directory-picker", () => ({
  DirectoryPicker: ({ label }: { label: string }) => <div>{label}</div>,
}));

vi.mock("@/components/widget/controls/bootstrap-config", () => ({
  BootstrapConfig: ({ label }: { label: string }) => <div>{label}</div>,
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    ui: {
      setPrefs: vi
        .fn<(prefs: { productAnalyticsEnabled?: boolean; sendDiagnostics?: boolean }) => Promise<void>>()
        .mockResolvedValue(undefined),
    },
  },
}));

const sendDiagnosticsField = {
  state: { value: false },
  handleChange: vi.fn<(value: boolean) => void>(),
};

const productAnalyticsField = {
  state: { value: true },
  handleChange: vi.fn<(value: boolean) => void>(),
};

const telemetry = {
  captureError: vi.fn<(error: unknown) => void>(),
  captureEvent: vi.fn<(event: { name: string }) => void>(),
  diagnosticsEnabled: false,
  productAnalyticsEnabled: true,
  reset: vi.fn<() => void>(),
  setDiagnosticsEnabled: vi.fn<(enabled: boolean) => void>(),
  setProductAnalyticsEnabled: vi.fn<(enabled: boolean) => void>(),
};

vi.mock("@/lib/telemetry/context", () => ({
  useTelemetry: () => telemetry,
}));

const baseProps = {
  configDir: "/Users/test/.darwin",
  handleRefreshHosts: vi.fn<() => void>(),
  hasFlake: true,
  host: "Test-MacBook",
  hosts: ["Test-MacBook"],
  productAnalyticsField: productAnalyticsField as never,
  saveHost: vi.fn<(value: string) => void>(),
  sendDiagnosticsField: sendDiagnosticsField as never,
  setSettingsOpen: vi.fn<(open: boolean) => void>(),
};

describe("GeneralTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens the Support Nixmac page from settings", async () => {
    render(<GeneralTab {...baseProps} />);

    await screen.findByText("0.0.0-test");
    expect(screen.getByText("Support Nixmac")).toBeInTheDocument();
    expect(screen.getByText("Help fund continued development.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Support Nixmac" }));

    expect(open).toHaveBeenCalledWith("https://nixmac.com/support");
  });

  it("persists product analytics without changing diagnostics", async () => {
    render(<GeneralTab {...baseProps} />);

    await screen.findByText("0.0.0-test");
    expect(screen.getByText("Share anonymous product usage")).toBeInTheDocument();
    expect(screen.getByText(/Does not include prompts/)).toBeInTheDocument();

    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[1]);

    expect(productAnalyticsField.handleChange).toHaveBeenCalledWith(false);
    expect(sendDiagnosticsField.handleChange).not.toHaveBeenCalled();
    expect(tauriAPI.ui.setPrefs).toHaveBeenCalledWith({ productAnalyticsEnabled: false });
    expect(tauriAPI.ui.setPrefs).not.toHaveBeenCalledWith({ sendDiagnostics: false });
    await waitFor(() => {
      expect(telemetry.setProductAnalyticsEnabled).toHaveBeenCalledWith(false);
    });
    expect(telemetry.captureEvent).toHaveBeenCalledWith({ name: "product_analytics_opt_out" });
    expect(telemetry.captureEvent.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(tauriAPI.ui.setPrefs).mock.invocationCallOrder[0],
    );
  });

  it("persists diagnostics without changing product analytics", async () => {
    render(<GeneralTab {...baseProps} />);

    await screen.findByText("0.0.0-test");
    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[0]);

    expect(sendDiagnosticsField.handleChange).toHaveBeenCalledWith(true);
    expect(productAnalyticsField.handleChange).not.toHaveBeenCalled();
    expect(tauriAPI.ui.setPrefs).toHaveBeenCalledWith({ sendDiagnostics: true });
    expect(tauriAPI.ui.setPrefs).not.toHaveBeenCalledWith({ productAnalyticsEnabled: true });
    await waitFor(() => {
      expect(telemetry.setDiagnosticsEnabled).toHaveBeenCalledWith(true);
    });
    expect(telemetry.captureEvent).toHaveBeenCalledWith({ name: "diagnostics_opt_in" });
  });
});
