import type { HelperPreference, Permission } from "@/ipc/types";
import {
  makeCompletedOnboardingState,
  makeGlobalPreferences,
  makeNixInstallState,
} from "@/utils/test-fixtures";
import { initialViewModelState, useViewModel } from "@nixmac/state";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HELPER_GRACE_MS, useRepair } from "./repair";

/**
 * The helper's banner is the one part of the repair plan that follows live state,
 * so what is worth testing is the timing: it must stay quiet while the backend is
 * still converging, speak once the condition has outlasted that, and go when the
 * helper answers — without a churning report ever holding it back.
 */

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    permissions: { refresh: vi.fn(async () => {}), request: vi.fn(async () => {}) },
  },
}));

vi.mock("@/lib/orpc", () => ({
  client: { flake: { exists: vi.fn(async () => true) } },
}));

vi.mock("@/lib/env", () => ({ settings: {} }));
vi.mock("@/router", () => ({ nav: { openSettings: vi.fn() } }));
vi.mock("@/components/widget/onboarding/restart-setup", () => ({
  RestartSetupConfirmation: () => null,
}));

const APPROVE_IN_LOGIN_ITEMS =
  "Approve nixmac in System Settings → General → Login Items & Extensions to finish enabling the unattended sync helper.";

function makeHelperRow(overrides: Partial<Permission> = {}): Permission {
  return {
    id: "privileged-helper",
    name: "Unattended Sync Helper",
    description: "",
    required: true,
    canRequestProgrammatically: false,
    status: "pending",
    instructions: APPROVE_IN_LOGIN_ITEMS,
    ...overrides,
  };
}

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
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    useViewModel.setState(initialViewModelState);
  });

  /** Mount and let the launch snapshot (an async flake probe) settle. */
  async function mount() {
    const view = renderHook(() => useRepair());
    await act(async () => {});
    return view;
  }

  it("stays quiet until the condition has outlasted the grace period", async () => {
    seedStore(makeHelperRow(), "granted");
    const { result } = await mount();

    expect(result.current.plan.banners).toEqual([]);

    await act(async () => {
      vi.advanceTimersByTime(HELPER_GRACE_MS);
    });

    expect(result.current.plan.banners).toEqual([
      { kind: "helper-inactive", instructions: APPROVE_IN_LOGIN_ITEMS },
    ]);
  });

  it("does not restart the clock when a still-failing report changes", async () => {
    seedStore(makeHelperRow(), "granted");
    const { result } = await mount();

    await act(async () => {
      vi.advanceTimersByTime(HELPER_GRACE_MS * 0.6);
      publishHelperRow(
        makeHelperRow({
          canRequestProgrammatically: true,
          instructions: "nixmac could not register the unattended sync helper.",
        }),
      );
    });
    expect(result.current.plan.banners).toEqual([]);

    // Past the grace period counted from the first report, not the second.
    await act(async () => {
      vi.advanceTimersByTime(HELPER_GRACE_MS * 0.6);
    });
    expect(result.current.plan.banners).toEqual([
      {
        kind: "helper-inactive",
        instructions: "nixmac could not register the unattended sync helper.",
      },
    ]);
  });

  it("clears the banner and the clock once the helper answers", async () => {
    seedStore(makeHelperRow(), "granted");
    const { result } = await mount();

    await act(async () => {
      vi.advanceTimersByTime(HELPER_GRACE_MS);
    });
    expect(result.current.plan.banners).toHaveLength(1);

    await act(async () => {
      publishHelperRow(
        makeHelperRow({
          status: "granted",
          canRequestProgrammatically: true,
          instructions: "The unattended sync helper is installed and answering.",
        }),
      );
    });
    expect(result.current.plan.banners).toEqual([]);

    // The clock was cleared with the banner, so a later regression waits again.
    await act(async () => {
      publishHelperRow(makeHelperRow());
    });
    expect(result.current.plan.banners).toEqual([]);

    await act(async () => {
      vi.advanceTimersByTime(HELPER_GRACE_MS);
    });
    expect(result.current.plan.banners).toHaveLength(1);
  });

  it("says nothing about a helper the user did not ask for", async () => {
    seedStore(makeHelperRow(), "unset");
    const { result } = await mount();

    await act(async () => {
      vi.advanceTimersByTime(HELPER_GRACE_MS);
    });

    expect(result.current.plan.banners).toEqual([]);
  });
});
