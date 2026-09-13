import type { HelperPreference, Permission } from "@/ipc/types";
import {
  APPROVE_IN_LOGIN_ITEMS,
  makeCompletedOnboardingState,
  makeGlobalPreferences,
  makeHelperRow,
  makeNixInstallState,
} from "@/utils/test-fixtures";
import { initialViewModelState, useViewModel } from "@nixmac/state";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RepairBanners, useRepair } from "./repair";

/**
 * The helper's banner is the one part of the repair plan that follows live state,
 * so it must follow the backend's typed phase and clear as soon as the helper
 * answers. Retry/approval actions are distinct and tested at the render surface.
 */

const { mockHelperRetry, mockPermissionRequest, mockRefresh } = vi.hoisted(() => ({
  mockHelperRetry: vi.fn<() => Promise<unknown>>(async () => ({})),
  mockPermissionRequest: vi.fn<
    (input: { permissionId: string }) => Promise<unknown>
  >(async () => ({})),
  mockRefresh: vi.fn<() => Promise<void>>(async () => {}),
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    permissions: { refresh: mockRefresh },
  },
}));

vi.mock("@/lib/orpc", () => ({
  client: {
    flake: { exists: vi.fn<() => Promise<boolean>>(async () => true) },
    darwin: { helperRetry: mockHelperRetry },
    permissions: { request: mockPermissionRequest },
  },
}));

vi.mock("@/lib/env", () => ({ settings: {} }));
vi.mock("@/router", () => ({ nav: { openSettings: vi.fn<(tab?: string) => void>() } }));
vi.mock("@/components/widget/onboarding/restart-setup", () => ({
  RestartSetupConfirmation: () => null,
}));

/** A completed profile whose only unsettled prerequisite is the helper row. */
function seedStore(helperRow: Permission, helperPreference: HelperPreference) {
  useViewModel.setState({
    hydrated: true,
    onboardingState: makeCompletedOnboardingState(),
    preferences: makeGlobalPreferences({
      configDir: "/Users/demo/.darwin",
      helperPreference,
    }),
    nixInstall: makeNixInstallState(),
    permissions: {
      permissions: [helperRow],
      allRequiredGranted: helperRow.status === "granted",
      checkedAt: 1,
    },
  });
}

/** What the backend publishes on a later reconciliation pass. */
function publishHelperRow(helperRow: Permission) {
  useViewModel.setState({
    permissions: {
      permissions: [helperRow],
      allRequiredGranted: helperRow.status === "granted",
      checkedAt: 2,
    },
  });
}

describe("useRepair", () => {
  afterEach(() => {
    vi.clearAllMocks();
    useViewModel.setState(initialViewModelState);
  });

  /** Mount and let the launch snapshot (an async flake probe) settle. */
  async function mount() {
    const view = renderHook(() => useRepair());
    await act(async () => {});
    return view;
  }

  it("shows approval immediately", async () => {
    seedStore(makeHelperRow(), "granted");
    const { result } = await mount();

    expect(result.current.plan.banners).toEqual([
      {
        kind: "helper-inactive",
        phase: "approvalRequired",
        instructions: APPROVE_IN_LOGIN_ITEMS,
      },
    ]);
  });

  it("follows reconciling and active-sync phases without parsing copy", async () => {
    seedStore(
      makeHelperRow({
        helperPhase: "reconciling",
        canRequestProgrammatically: true,
        instructions: "nixmac is finishing unattended sync setup.",
      }),
      "granted",
    );
    const { result } = await mount();

    expect(result.current.plan.banners[0]).toMatchObject({
      kind: "helper-inactive",
      phase: "reconciling",
    });

    act(() => {
      publishHelperRow(
        makeHelperRow({
          helperPhase: "waitingForActivation",
          canRequestProgrammatically: true,
          instructions: "Waiting for the current sync.",
        }),
      );
    });
    expect(result.current.plan.banners).toEqual([
      {
        kind: "helper-inactive",
        phase: "waitingForActivation",
        instructions: "Waiting for the current sync.",
      },
    ]);
  });

  it("clears the banner once the helper answers", async () => {
    seedStore(makeHelperRow({ helperPhase: "failed" }), "granted");
    const { result } = await mount();
    expect(result.current.plan.banners).toHaveLength(1);

    act(() => {
      publishHelperRow(
        makeHelperRow({
          status: "granted",
          helperPhase: "ready",
          canRequestProgrammatically: true,
          instructions: "The unattended sync helper is installed and answering.",
        }),
      );
    });
    expect(result.current.plan.banners).toEqual([]);
  });

  it("does not let dismissal of one phase hide a later failure", async () => {
    seedStore(makeHelperRow(), "granted");
    const { result } = await mount();

    act(() => result.current.dismissBanner("helper-inactive"));
    expect(result.current.plan.banners).toEqual([]);

    act(() => {
      publishHelperRow(
        makeHelperRow({
          helperPhase: "failed",
          canRequestProgrammatically: true,
          instructions: "Try again.",
        }),
      );
    });
    expect(result.current.plan.banners[0]).toMatchObject({
      kind: "helper-inactive",
      phase: "failed",
    });
  });

  it("says nothing about a helper the user did not ask for", async () => {
    seedStore(makeHelperRow(), "unset");
    const { result } = await mount();

    expect(result.current.plan.banners).toEqual([]);
  });
});

describe("RepairBanners helper actions", () => {
  afterEach(() => vi.clearAllMocks());

  it("opens System Settings only for approval", async () => {
    render(
      <RepairBanners
        banners={[
          {
            kind: "helper-inactive",
            phase: "approvalRequired",
            instructions: APPROVE_IN_LOGIN_ITEMS,
          },
        ]}
        onDismiss={() => {}}
        onRecheck={mockRefresh}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open System Settings" }));
    await waitFor(() => expect(mockPermissionRequest).toHaveBeenCalled());
    expect(mockHelperRetry).not.toHaveBeenCalled();
  });

  it("retries only a failed helper", async () => {
    render(
      <RepairBanners
        banners={[
          {
            kind: "helper-inactive",
            phase: "failed",
            instructions: "Try again.",
          },
        ]}
        onDismiss={() => {}}
        onRecheck={mockRefresh}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mockHelperRetry).toHaveBeenCalled());
    expect(mockPermissionRequest).not.toHaveBeenCalled();
  });

  it("offers no repair action while waiting for an activation", () => {
    render(
      <RepairBanners
        banners={[
          {
            kind: "helper-inactive",
            phase: "waitingForActivation",
            instructions: "Waiting for the current sync.",
          },
        ]}
        onDismiss={() => {}}
        onRecheck={mockRefresh}
      />,
    );
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open System Settings" })).toBeNull();
  });

  it("keeps move or restart guidance instead of offering an ineffective retry", () => {
    render(
      <RepairBanners
        banners={[
          {
            kind: "helper-inactive",
            phase: "needsUserAction",
            instructions: "Move nixmac to /Applications and restart it.",
          },
        ]}
        onDismiss={() => {}}
        onRecheck={mockRefresh}
      />,
    );
    expect(screen.getByText("Move nixmac to /Applications and restart it.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});
