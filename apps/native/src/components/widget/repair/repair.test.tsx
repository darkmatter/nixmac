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

  it("reports a failed banner Retry through its diagnostic", async () => {
    mockHelperRetry.mockRejectedValueOnce(new Error("IPC channel closed"));
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
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Retrying the unattended sync helper failed: IPC channel closed Try again. If this keeps happening, report the problem.",
    );
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();

    // A later attempt clears the earlier failure.
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("drops a failed Retry's error once the helper leaves that failure", async () => {
    mockHelperRetry.mockRejectedValueOnce(new Error("IPC channel closed"));
    const failed = [
      { kind: "helper-inactive" as const, phase: "failed" as const, instructions: "Try again." },
    ];
    const { rerender } = render(
      <RepairBanners banners={failed} onDismiss={() => {}} onRecheck={mockRefresh} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("alert")).toBeTruthy();

    // Recovered: the banner goes away, then a new failure starts clean.
    rerender(<RepairBanners banners={[]} onDismiss={() => {}} onRecheck={mockRefresh} />);
    rerender(<RepairBanners banners={failed} onDismiss={() => {}} onRecheck={mockRefresh} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mockHelperRetry).toHaveBeenCalledTimes(1);

    // Another phase in between clears it the same way.
    mockHelperRetry.mockRejectedValueOnce(new Error("IPC channel closed"));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    rerender(
      <RepairBanners
        banners={[{ kind: "helper-inactive", phase: "reconciling", instructions: null }]}
        onDismiss={() => {}}
        onRecheck={mockRefresh}
      />,
    );
    rerender(<RepairBanners banners={failed} onDismiss={() => {}} onRecheck={mockRefresh} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores a Retry that settles after its failure episode ended", async () => {
    let rejectFirst!: (error: Error) => void;
    mockHelperRetry.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectFirst = reject;
      }),
    );
    const failed = [
      { kind: "helper-inactive" as const, phase: "failed" as const, instructions: "Try again." },
    ];
    const { rerender } = render(
      <RepairBanners banners={failed} onDismiss={() => {}} onRecheck={mockRefresh} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mockHelperRetry).toHaveBeenCalledTimes(1);

    // The helper recovers and fails again while the first request is pending.
    rerender(<RepairBanners banners={[]} onDismiss={() => {}} onRecheck={mockRefresh} />);
    rerender(<RepairBanners banners={failed} onDismiss={() => {}} onRecheck={mockRefresh} />);

    await act(async () => {
      rejectFirst(new Error("IPC channel closed"));
    });
    expect(screen.queryByRole("alert")).toBeNull();

    // A Retry made in the new episode still reports its own failure.
    mockHelperRetry.mockRejectedValueOnce(new Error("helper action transport failed"));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "helper action transport failed",
    );
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
