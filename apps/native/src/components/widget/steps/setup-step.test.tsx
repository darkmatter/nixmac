import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { TelemetryEvent } from "@/lib/telemetry/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCaptureEvent, mockSaveHost, widgetState } = vi.hoisted(() => ({
  mockCaptureEvent: vi.fn<(event: TelemetryEvent) => void>(),
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
  DirectoryPicker: () => <div data-testid="directory-picker" />,
}));

vi.mock("@/components/widget/controls/bootstrap-config", () => ({
  BootstrapConfig: () => <div data-testid="bootstrap-config" />,
}));

vi.mock("@/lib/telemetry/instance", () => ({
  getTelemetry: () => ({
    captureEvent: mockCaptureEvent,
  }),
}));

import { SetupStep } from "./setup-step";

describe("<SetupStep>", () => {
  beforeEach(() => {
    widgetState.configDir = "";
    widgetState.hosts = [];
    widgetState.host = "";
    widgetState.error = null;
    mockCaptureEvent.mockReset();
    mockSaveHost.mockReset();
    mockSaveHost.mockResolvedValue();
  });

  it("does not emit onboarding telemetry from a transient setup render", () => {
    render(<SetupStep />);

    expect(mockCaptureEvent).not.toHaveBeenCalled();
  });

  it("persists the displayed host when Next is clicked without changing the dropdown", async () => {
    widgetState.configDir = "/Users/me/.nixmac";
    widgetState.hosts = ["mbp"];
    widgetState.host = "mbp";

    render(<SetupStep />);

    const next = await screen.findByRole("button", { name: "Next" });
    fireEvent.click(next);

    await waitFor(() =>
      expect(mockSaveHost).toHaveBeenCalledWith("mbp", {
        telemetrySurface: "onboarding",
      }),
    );
    expect(mockSaveHost).not.toHaveBeenCalledWith("");
  });
});
