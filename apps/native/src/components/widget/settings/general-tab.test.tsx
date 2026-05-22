import { fireEvent, render, screen } from "@testing-library/react";
import { open } from "@tauri-apps/plugin-shell";
import { describe, expect, it, vi } from "vitest";
import { GeneralTab } from "./general-tab";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("0.0.0-test"),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/components/widget/controls/directory-picker", () => ({
  DirectoryPicker: ({ label }: { label: string }) => <div>{label}</div>,
}));

vi.mock("@/components/widget/controls/bootstrap-config", () => ({
  BootstrapConfig: ({ label }: { label: string }) => <div>{label}</div>,
}));

vi.mock("@/tauri-api", () => ({
  tauriAPI: {
    ui: {
      setPrefs: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

const sendDiagnosticsField = {
  state: { value: false },
  handleChange: vi.fn(),
};

describe("GeneralTab", () => {
  it("opens the Support Nixmac page from settings", async () => {
    render(
      <GeneralTab
        configDir="/Users/test/.darwin"
        handleRefreshHosts={vi.fn()}
        hasFlake
        host="Test-MacBook"
        hosts={["Test-MacBook"]}
        saveHost={vi.fn()}
        sendDiagnosticsField={sendDiagnosticsField as never}
        setSettingsOpen={vi.fn()}
      />,
    );

    await screen.findByText("0.0.0-test");
    expect(screen.getByText("Support Nixmac")).toBeInTheDocument();
    expect(screen.getByText("Help fund continued development.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Support Nixmac" }));

    expect(open).toHaveBeenCalledWith("https://nixmac.com/support");
  });
});
