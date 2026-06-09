import { fireEvent, render, screen } from "@testing-library/react";
import { open } from "@tauri-apps/plugin-shell";
import { describe, expect, it, vi } from "vitest";
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
        .fn<(prefs: Record<string, unknown>) => Promise<void>>()
        .mockResolvedValue(undefined),
    },
  },
}));

const sendDiagnosticsField = {
  state: { value: false },
  handleChange: vi.fn<(checked: boolean) => void>(),
};

function renderGeneralTab() {
  return render(
    <GeneralTab
      configDir="/Users/test/.darwin"
      handleRefreshHosts={vi.fn<() => void>()}
      hasFlake
      host="Test-MacBook"
      hosts={["Test-MacBook"]}
      saveHost={vi.fn<(value: string) => void>()}
      sendDiagnosticsField={sendDiagnosticsField as never}
      setSettingsOpen={vi.fn<(value: boolean) => void>()}
    />,
  );
}

describe("GeneralTab", () => {
  it("opens the Support Nixmac page from settings", async () => {
    renderGeneralTab();

    await screen.findByText("0.0.0-test");
    expect(screen.getByText("Support Nixmac")).toBeInTheDocument();
    expect(screen.getByText("Help fund continued development.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Support Nixmac" }));

    expect(open).toHaveBeenCalledWith("https://nixmac.com/support");
  });

  it("shows Privacy Policy after Support Nixmac and opens the public policy", async () => {
    renderGeneralTab();

    await screen.findByText("0.0.0-test");

    const supportRow = screen.getByText("Support Nixmac");
    const privacyRow = screen.getByText("Privacy Policy");
    const versionRow = screen.getByText("Version");

    expect(
      supportRow.compareDocumentPosition(privacyRow) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      privacyRow.compareDocumentPosition(versionRow) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open Privacy Policy" }));

    expect(open).toHaveBeenCalledWith("https://nixmac.com/privacy");
  });
});
