import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RouterProvider, nav, router } from "@/router";

// The root layout mounts DarwinWidget alongside the settings overlay; its
// side-effect hooks are irrelevant to this test.
vi.mock("@/components/widget/widget", () => ({
  DarwinWidget: () => null,
}));

// Tab contents are exercised by their own tests — stub them all so switching
// module-level imports don't drag in the IPC layer.
vi.mock("@/components/widget/settings/account-tab", () => ({ AccountTab: () => null }));
vi.mock("@/components/widget/settings/ai-models-tab", () => ({ AiModelsTab: () => null }));
vi.mock("@/components/widget/settings/api-keys-tab", () => ({ ApiKeysTab: () => null }));
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
});
