import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RouterProvider, nav, router } from "@/router";

type ApiKeysTabSaveProps = {
  onSaveOpenaiCompatibleUrl: (url: string) => Promise<void>;
  onSaveOpenaiCompatibleKey: (key: string) => Promise<void>;
};

const apiKeysTab = vi.hoisted(() => ({ props: null as ApiKeysTabSaveProps | null }));
const orpcClient = vi.hoisted(() => ({
  clearCached: vi.fn<(input: { provider: string }) => Promise<void>>().mockResolvedValue(undefined),
}));

// The root layout mounts DarwinWidget alongside the settings overlay; its
// side-effect hooks are irrelevant to this test.
vi.mock("@/components/widget/widget", () => ({
  DarwinWidget: () => null,
}));

// Tab contents are exercised by their own tests — stub them all so switching
// module-level imports don't drag in the IPC layer.
vi.mock("@/components/widget/settings/account-tab", () => ({ AccountTab: () => null }));
vi.mock("@/components/widget/settings/ai-models-tab", () => ({ AiModelsTab: () => null }));
vi.mock("@/components/widget/settings/api-keys-tab", () => ({
  ApiKeysTab: (props: ApiKeysTabSaveProps) => {
    apiKeysTab.props = props;
    return null;
  },
}));
vi.mock("@/components/widget/settings/developer-tab", () => ({ DeveloperTab: () => null }));
vi.mock("@/components/widget/settings/general-tab", () => ({ GeneralTab: () => null }));
vi.mock("@/components/widget/settings/permissions-tab", () => ({ PermissionsTab: () => null }));
vi.mock("@/components/widget/settings/preferences-tab", () => ({ PreferencesTab: () => null }));
vi.mock("@/components/widget/settings/tuning-tab", () => ({ TuningTab: () => null }));

vi.mock("@/hooks/use-darwin-config", () => ({
  useDarwinConfig: () => ({ saveHost: vi.fn() }),
}));

vi.mock("@/viewmodel/preferences", () => ({
  refreshHostsSnapshot: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    ui: {
      getPrefs: vi.fn().mockResolvedValue(null),
      setPrefs: vi.fn().mockResolvedValue(undefined),
    },
    models: {
      clearCached: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

vi.mock("@/lib/orpc", () => ({
  client: { models: { clearCached: orpcClient.clearCached } },
}));

describe("SettingsDialog", () => {
  // Regression: the settings overlay used to cover the app-level drag strip,
  // making the window undraggable while settings was open. The dialog must
  // provide its own strip, painted above the click-to-close backdrop.
  it("keeps a window drag strip above the backdrop", async () => {
    render(<RouterProvider router={router} />);
    await act(async () => {
      await nav.openSettings();
    });

    const backdrop = await screen.findByRole("button", { name: "Close settings" });
    const strip = document.querySelector("[data-tauri-drag-region]");
    expect(strip).not.toBeNull();

    // Tauri 2.9's drag handler keys off `e.target` only, so the strip must be
    // a childless leaf — any child under the cursor breaks dragging.
    expect(strip?.childElementCount).toBe(0);

    // Same stacking context as the backdrop, later in the DOM → paints above
    // it, so the strip (not the backdrop) receives the mouse-down.
    expect(strip?.parentElement).toBe(backdrop.parentElement);
    expect(backdrop.compareDocumentPosition(strip as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("explains the hosted-model action after a logout", async () => {
    render(<RouterProvider router={router} />);
    await act(async () => {
      await nav.openSettings("ai-models", "hosted-auth");
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Log back in or select another model to continue.",
    );
    expect(screen.getByRole("button", { name: "Log back in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select another model" })).toBeInTheDocument();
  });

  // Regression: the model picker caches OpenAI-compatible models under the
  // provider id `openai_compatible`, but saving the endpoint or key cleared a
  // `vllm` entry instead, so the picker kept showing the old server's models.
  it("clears the OpenAI-compatible model cache when its endpoint or key is saved", async () => {
    render(<RouterProvider router={router} />);
    await act(async () => {
      await nav.openSettings("api-keys");
    });

    const props = await vi.waitFor(() => {
      if (!apiKeysTab.props) throw new Error("API keys tab not rendered yet");
      return apiKeysTab.props;
    });
    orpcClient.clearCached.mockClear();

    await act(async () => {
      await props.onSaveOpenaiCompatibleUrl("http://localhost:8000/v1");
      await props.onSaveOpenaiCompatibleKey("sk-test");
    });

    expect(orpcClient.clearCached.mock.calls).toEqual([
      [{ provider: "openai_compatible" }],
      [{ provider: "openai_compatible" }],
    ]);
  });
});
