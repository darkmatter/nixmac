import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSaveHost, widgetState } = vi.hoisted(() => ({
  mockSaveHost: vi.fn<(host: string) => Promise<void>>(),
  widgetState: {
    configDir: "",
    hosts: [] as string[],
    host: "",
    error: null as string | null,
    aiProviderOnboardingComplete: false,
    setAiProviderOnboardingComplete: vi.fn<(complete: boolean) => void>(),
    setSettingsOpen: vi.fn<(open: boolean, tab?: string | null) => void>(),
  },
}));

const apiMocks = vi.hoisted(() => ({
  setPrefs: vi.fn(),
  checkTools: vi.fn(),
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

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    ui: {
      setPrefs: apiMocks.setPrefs,
    },
    cli: {
      checkTools: apiMocks.checkTools,
    },
  },
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

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    onValueChange,
    value,
  }: {
    children: ReactNode;
    onValueChange?: (value: string) => void;
    value?: string;
  }) => (
    <select
      aria-label="mock select"
      onChange={(event) => onValueChange?.(event.target.value)}
      value={value}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{typeof children === "string" ? children : value}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

import { SetupStep } from "./setup-step";

describe("<SetupStep>", () => {
  beforeEach(() => {
    widgetState.configDir = "";
    widgetState.hosts = [];
    widgetState.host = "";
    widgetState.error = null;
    widgetState.aiProviderOnboardingComplete = false;
    widgetState.setAiProviderOnboardingComplete.mockReset();
    widgetState.setSettingsOpen.mockReset();
    mockSaveHost.mockReset();
    mockSaveHost.mockResolvedValue();
    apiMocks.setPrefs.mockReset();
    apiMocks.setPrefs.mockResolvedValue({ ok: true });
    apiMocks.checkTools.mockReset();
    apiMocks.checkTools.mockResolvedValue({ claude: true, codex: true, opencode: true });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true }),
    );
  });

  it("persists the displayed host when Next is clicked without changing the dropdown", async () => {
    widgetState.configDir = "/Users/me/.nixmac";
    widgetState.hosts = ["mbp"];
    widgetState.host = "mbp";
    widgetState.aiProviderOnboardingComplete = true;

    render(<SetupStep />);

    const start = await screen.findByRole("button", { name: "Start using nixmac" });
    fireEvent.click(start);

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

  it("shows the AI provider step after a host is available", async () => {
    widgetState.configDir = "/Users/me/.nixmac";
    widgetState.hosts = ["mbp"];
    widgetState.host = "mbp";

    render(<SetupStep />);

    expect(await screen.findByRole("heading", { name: "3. AI Provider" })).toBeInTheDocument();
    expect(
      screen.getByText("nixmac uses an AI provider to plan and summarize config changes."),
    ).toBeInTheDocument();
  });

  it("does not show the start button for a stale stored host that is not in the host list", async () => {
    widgetState.configDir = "/Users/me/.nixmac";
    widgetState.hosts = [];
    widgetState.host = "mbp";
    widgetState.aiProviderOnboardingComplete = true;

    render(<SetupStep />);

    expect(await screen.findByRole("heading", { name: "3. AI Provider" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start using nixmac" })).not.toBeInTheDocument();
  });

  it("allows an explicit AI provider skip before starting nixmac", async () => {
    widgetState.configDir = "/Users/me/.nixmac";
    widgetState.hosts = ["mbp"];
    widgetState.host = "mbp";

    const view = render(<SetupStep />);

    fireEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
    await waitFor(() =>
      expect(apiMocks.setPrefs).toHaveBeenCalledWith({ aiProviderOnboardingSkipped: true }),
    );
    expect(widgetState.setAiProviderOnboardingComplete).toHaveBeenCalledWith(true);
    widgetState.aiProviderOnboardingComplete = true;
    view.rerender(<SetupStep />);
    fireEvent.click(screen.getByRole("button", { name: "Start using nixmac" }));

    await waitFor(() => expect(mockSaveHost).toHaveBeenCalledWith("mbp"));
    expect(
      screen.getByText("AI changes will stay disabled until you add a provider in Settings."),
    ).toBeInTheDocument();
  });

  it("verifies and saves OpenRouter during onboarding", async () => {
    widgetState.configDir = "/Users/me/.nixmac";
    widgetState.hosts = ["mbp"];
    widgetState.host = "mbp";

    render(<SetupStep />);

    fireEvent.change(await screen.findByLabelText("OpenRouter API key"), {
      target: { value: "sk-or-valid" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save provider" }));

    await waitFor(() =>
      expect(apiMocks.setPrefs).toHaveBeenCalledWith({
        openrouterApiKey: "sk-or-valid",
        evolveProvider: "openrouter",
        evolveModel: "anthropic/claude-sonnet-4",
        summaryProvider: "openrouter",
        summaryModel: "openai/gpt-4o-mini",
        aiProviderOnboardingSkipped: false,
      }),
    );
    expect(widgetState.setAiProviderOnboardingComplete).toHaveBeenCalledWith(true);
    expect(await screen.findByText("Provider ready.")).toBeInTheDocument();
  });

  it("shows a recoverable error when saving provider preferences fails", async () => {
    widgetState.configDir = "/Users/me/.nixmac";
    widgetState.hosts = ["mbp"];
    widgetState.host = "mbp";
    apiMocks.setPrefs.mockRejectedValueOnce(new Error("store unavailable"));

    render(<SetupStep />);

    fireEvent.change(await screen.findByLabelText("OpenRouter API key"), {
      target: { value: "sk-or-valid" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save provider" }));

    expect(
      await screen.findByText("Could not save provider settings. Please try again."),
    ).toBeInTheDocument();
    expect(widgetState.setAiProviderOnboardingComplete).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save provider" })).toBeEnabled();
  });

  it("blocks CLI provider saves until tool availability is known", async () => {
    widgetState.configDir = "/Users/me/.nixmac";
    widgetState.hosts = ["mbp"];
    widgetState.host = "mbp";
    apiMocks.checkTools.mockReturnValue(new Promise(() => {}));

    render(<SetupStep />);

    const providerSelect = (await screen.findAllByRole("combobox"))[1];
    fireEvent.change(providerSelect, { target: { value: "codex" } });

    const saveProvider = screen.getByRole("button", { name: "Save provider" });
    expect(saveProvider).toBeDisabled();
    fireEvent.click(saveProvider);

    expect(apiMocks.setPrefs).not.toHaveBeenCalled();
    expect(widgetState.setAiProviderOnboardingComplete).not.toHaveBeenCalled();
  });

  it("requires a new save or skip when the provider form changes after completion", async () => {
    widgetState.configDir = "/Users/me/.nixmac";
    widgetState.hosts = ["mbp"];
    widgetState.host = "mbp";

    const view = render(<SetupStep />);

    fireEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
    await waitFor(() =>
      expect(apiMocks.setPrefs).toHaveBeenCalledWith({ aiProviderOnboardingSkipped: true }),
    );
    expect(widgetState.setAiProviderOnboardingComplete).toHaveBeenCalledWith(true);

    widgetState.aiProviderOnboardingComplete = true;
    view.rerender(<SetupStep />);
    expect(screen.getByRole("button", { name: "Start using nixmac" })).toBeInTheDocument();

    const providerSelect = screen.getAllByRole("combobox")[1];
    fireEvent.change(providerSelect, { target: { value: "codex" } });

    expect(widgetState.setAiProviderOnboardingComplete).toHaveBeenCalledWith(false);
    widgetState.aiProviderOnboardingComplete = false;
    view.rerender(<SetupStep />);

    expect(screen.queryByRole("button", { name: "Start using nixmac" })).not.toBeInTheDocument();
  });
});
