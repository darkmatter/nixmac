import type { Permission, PermissionStatus } from "@/ipc/types";
import { HELPER_PERMISSION_ID } from "@/lib/permissions";
import { APPROVE_IN_LOGIN_ITEMS } from "@/utils/test-fixtures";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The helper row is the one permission nixmac installs rather than asks macOS
 * for, so it is the one row that can hand it back. A persistent failure keeps
 * that Disable escape hatch and adds a non-destructive Retry. Everything else
 * comes from the backend's typed phase and customer-facing sentence.
 */

const mockRefresh = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRequest = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const mockDisableHelper = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRetryHelper = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    permissions: {
      refresh: (...args: unknown[]) => mockRefresh(...args),
      request: (...args: unknown[]) => mockRequest(...args),
      requestFullDiskAccess: vi.fn<() => void>(),
    },
  },
}));

vi.mock("@/lib/orpc", () => ({
  client: {
    darwin: {
      helperDisable: (...args: unknown[]) => mockDisableHelper(...args),
      helperRetry: (...args: unknown[]) => mockRetryHelper(...args),
    },
    permissions: {
      refresh: (...args: unknown[]) => mockRefresh(...args),
    },
  },
  orpc: {
    system: {
      installLocation: {
        queryOptions: () => ({
          queryKey: ["installLocation"],
          queryFn: async () => ({ bundlePath: null, inApplicationsDir: false }),
        }),
      },
    },
  },
}));

const permissionsState = vi.fn<() => unknown>();
const helperPreference = vi.fn<() => string>();
vi.mock("@nixmac/state", () => ({
  useViewModel: (select: (state: { permissions: unknown; preferences: unknown }) => unknown) =>
    select({
      permissions: permissionsState(),
      preferences: { helperPreference: helperPreference() },
    }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { bundlePath: null, inApplicationsDir: false } }),
}));

function helperPermission(overrides: Partial<Permission>) {
  return {
    id: HELPER_PERMISSION_ID,
    name: "Unattended Sync Helper",
    description: "Required for unattended device sync",
    required: true,
    canRequestProgrammatically: true,
    status: "pending",
    instructions: "a report",
    helperPhase: "reconciling",
    ...overrides,
  };
}

function helperRow(status: PermissionStatus, instructions: string, ...others: unknown[]) {
  return {
    permissions: [helperPermission({ status, instructions }), ...others],
    allRequiredGranted: status === "granted",
    checkedAt: null,
  };
}

/**
 * The row the backend sends while macOS holds the registration pending approval
 * in Login Items: the sentence names the pane, and `canRequestProgrammatically`
 * is false because no run nixmac makes can finish it — only the user can.
 */
function awaitingApprovalRow() {
  return {
    permissions: [
      helperPermission({
        instructions: APPROVE_IN_LOGIN_ITEMS,
        canRequestProgrammatically: false,
        helperPhase: "approvalRequired",
      }),
    ],
    allRequiredGranted: false,
    checkedAt: null,
  };
}

/**
 * A second row, to check that one row's action leaves the other's alone.
 *
 * `admin` specifically: its grant takes `handleGrant`'s plain
 * `permissions.request` branch, so the mocked request is what holds the action in
 * flight. The `full-disk` and `app-management` branches wait out a `setTimeout`
 * of their own, which would settle the row after the test body and take its
 * running label with it.
 */
const adminRow = {
  id: "admin",
  name: "Administrator Privileges",
  description: "Required to install system packages and modify system configurations",
  required: true,
  canRequestProgrammatically: false,
  status: "pending",
  instructions: "You will be prompted for your password when needed",
};

async function panel() {
  const { PermissionsPanel } = await import("./permissions-panel");
  const rendered = render(<PermissionsPanel />);
  // The store is mocked as a bare selector call, so nothing re-renders on its
  // own when a mocked value changes: a test that flips one mid-flight has to ask
  // for the render itself, or it asserts against the pre-flip markup.
  return { ...rendered, repaint: () => rendered.rerender(<PermissionsPanel />) };
}

describe("PermissionsPanel — the unattended sync helper row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefresh.mockResolvedValue(undefined);
    helperPreference.mockReturnValue("unset");
  });

  it("offers Enable, and only Enable, while no helper is wanted", async () => {
    for (const preference of ["unset", "disabled"]) {
      helperPreference.mockReturnValue(preference);
      permissionsState.mockReturnValue(
        helperRow("pending", "The unattended sync helper is not installed."),
      );

      const { unmount } = await panel();

      expect(screen.getByRole("button", { name: "Enable" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Disable" })).toBeNull();
      unmount();
    }
  });

  it("offers Disable in every state the helper is wanted in, granted or not", async () => {
    // A row that is not granted is still one nixmac keeps reconciling towards on
    // its own, so the only thing left for the user to decide is whether they
    // still want it — and offering Disable only on a granted row would leave a
    // helper this build cannot use with no way out but Enable, which records the
    // opposite. The reports that want the user to act say so in `instructions`.
    // The one exception is approval pending, which has its own test below.
    helperPreference.mockReturnValue("granted");
    for (const status of ["granted", "pending", "denied", "unknown"] as const) {
      permissionsState.mockReturnValue(helperRow(status, "a report"));

      const { unmount } = await panel();

      expect(screen.getByRole("button", { name: "Disable" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
      unmount();
    }
  });

  it("offers Retry without removing Disable after automatic recovery fails", async () => {
    helperPreference.mockReturnValue("granted");
    permissionsState.mockReturnValue({
      permissions: [
        helperPermission({
          helperPhase: "failed",
          instructions: "nixmac couldn’t finish enabling unattended sync. Try again.",
        }),
      ],
      allRequiredGranted: false,
      checkedAt: null,
    });
    mockRetryHelper.mockResolvedValue({
      atThisBuild: false,
      phase: "reconciling",
      detail: "nixmac is finishing unattended sync setup.",
    });

    const { getByRole } = await panel();
    expect(getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(getByRole("button", { name: "Disable" })).toBeTruthy();

    fireEvent.click(getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(mockRetryHelper).toHaveBeenCalledTimes(1);
      expect(mockRefresh).toHaveBeenCalled();
    });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it.each(["Retry", "Disable"] as const)(
    "keeps %s as the only helper action until it finishes",
    async (action) => {
      helperPreference.mockReturnValue("granted");
      permissionsState.mockReturnValue({
        permissions: [helperPermission({ helperPhase: "failed" })],
        allRequiredGranted: false,
        checkedAt: null,
      });
      let finish: () => void = () => {};
      const pending = new Promise((resolve) => {
        finish = () => resolve({ detail: "Finished." });
      });
      (action === "Retry" ? mockRetryHelper : mockDisableHelper).mockReturnValue(pending);

      const { repaint } = await panel();
      fireEvent.click(screen.getByRole("button", { name: action }));

      const busyLabel = action === "Retry" ? "Retrying…" : "Disabling…";
      expect(screen.getByRole("button", { name: busyLabel })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Disable" })).toBeNull();

      // Reconciliation publishes progress before the request settles.
      permissionsState.mockReturnValue({
        permissions: [helperPermission({ helperPhase: "reconciling" })],
        allRequiredGranted: false,
        checkedAt: null,
      });
      repaint();
      expect(screen.getByRole("button", { name: busyLabel })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();

      finish();
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: busyLabel })).toBeNull();
        expect(screen.getByRole("button", { name: "Disable" })).toBeEnabled();
      });
    },
  );

  it("retries a failed removal without offering to enable the helper again", async () => {
    helperPreference.mockReturnValue("disabled");
    permissionsState.mockReturnValue({
      permissions: [helperPermission({ helperPhase: "failed" })],
      allRequiredGranted: false,
      checkedAt: null,
    });
    mockRetryHelper.mockResolvedValue({ phase: "disabled" });

    await panel();
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Disable" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mockRetryHelper).toHaveBeenCalledOnce();
      expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    });
    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockDisableHelper).not.toHaveBeenCalled();
  });

  it("offers the Login Items deep link, not Disable, while approval is pending", async () => {
    // macOS is holding the registration and nothing nixmac does next makes that
    // go, so the row offers the same "Open Settings" action as the other rows
    // that send the user into System Settings — the pane the sentence names,
    // which is where macOS asks for the approval. Disable would be answering a
    // question the user has not been asked yet, and Enable would run a
    // reconciliation that can only report the same thing again.
    for (const preference of ["unset", "granted"]) {
      helperPreference.mockReturnValue(preference);
      permissionsState.mockReturnValue(awaitingApprovalRow());

      const { unmount } = await panel();

      expect(screen.getByRole("button", { name: /Open Settings/ })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Disable" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
      expect(screen.getByText(APPROVE_IN_LOGIN_ITEMS)).toBeTruthy();
      unmount();
    }
  });

  it("does not offer an ineffective Enable for a helper that needs an app move or restart", async () => {
    helperPreference.mockReturnValue("unset");
    permissionsState.mockReturnValue({
      permissions: [
        helperPermission({
          helperPhase: "needsUserAction",
          instructions: "Move nixmac to /Applications and restart it.",
        }),
      ],
      allRequiredGranted: false,
      checkedAt: null,
    });

    await panel();

    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
    expect(screen.getByText("Move nixmac to /Applications and restart it.")).toBeTruthy();
  });

  it("opens Login Items through the same grant action the row always used", async () => {
    // The deep link is not a new backend call: it is `permissions.request` for
    // this row, which records the decision and reconciles, and is the only action
    // allowed to open Login Items. In this state it opens them before it
    // reconciles at all — the registration is already waiting for approval, so
    // the pane does not depend on what the run goes on to report.
    helperPreference.mockReturnValue("granted");
    permissionsState.mockReturnValue(awaitingApprovalRow());
    mockRequest.mockResolvedValue({ id: HELPER_PERMISSION_ID, status: "pending" });

    const { getByRole } = await panel();
    fireEvent.click(getByRole("button", { name: /Open Settings/ }));

    await waitFor(() => {
      expect(mockRequest).toHaveBeenCalledWith(HELPER_PERMISSION_ID);
      expect(mockRefresh).toHaveBeenCalled();
    });
    expect(mockDisableHelper).not.toHaveBeenCalled();
  });

  it.each(["before", "after"] as const)(
    "drops approval instructions when the helper becomes ready %s the grant response",
    async (readyWhen) => {
      permissionsState.mockReturnValue(
        helperRow("pending", "The unattended sync helper is not installed."),
      );
      let finishGrant: () => void = () => {};
      mockRequest.mockReturnValue(
        new Promise((resolve) => {
          finishGrant = () => resolve(awaitingApprovalRow().permissions[0]);
        }),
      );

      const { repaint } = await panel();
      fireEvent.click(screen.getByRole("button", { name: "Enable" }));
      helperPreference.mockReturnValue("granted");
      permissionsState.mockReturnValue(awaitingApprovalRow());
      repaint();

      if (readyWhen === "after") {
        finishGrant();
        await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(2));
        expect(screen.getAllByText(APPROVE_IN_LOGIN_ITEMS)).toHaveLength(1);
      }

      const ready = "The unattended sync helper is installed and answering.";
      permissionsState.mockReturnValue({
        permissions: [
          helperPermission({ status: "granted", helperPhase: "ready", instructions: ready }),
        ],
        allRequiredGranted: true,
        checkedAt: null,
      });
      repaint();

      if (readyWhen === "before") {
        finishGrant();
        await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(2));
      }

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Disable" })).toBeEnabled(),
      );
      expect(screen.getByText(ready)).toBeTruthy();
      expect(screen.queryByText(APPROVE_IN_LOGIN_ITEMS)).toBeNull();
      expect(screen.queryByRole("button", { name: /Open Settings/ })).toBeNull();
    },
  );

  it("offers Disable on a granted row whose decision was never recorded", async () => {
    // An adopted registration: the reconciliation run records `granted` before
    // it reports, so this is the window before the mirrored preference catches
    // up. A granted row must never offer to enable what is already enabled.
    helperPreference.mockReturnValue("unset");
    permissionsState.mockReturnValue(helperRow("granted", "installed and answering"));

    await panel();

    expect(screen.getByRole("button", { name: "Disable" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
  });

  it("renders actionable and friendly helper copy", async () => {
    // The vocabulary: move the app, restart it, wait out a running activation
    // (with and without the activation's details), and plain failures. Each
    // arrives as the row's instructions and is shown verbatim — the UI never
    // re-words a report. All of them are reachable with the helper wanted,
    // which is what this row is. Approval pending comes with a row of its own
    // and is asserted in the Login Items test above. The sentences mirror the
    // backend's `helper_permission::describe` vocabulary.
    helperPreference.mockReturnValue("granted");
    for (const report of [
      "nixmac runs from /Volumes/nixmac/nixmac.app — move it to /Applications.",
      "this app was replaced while running (build a is running, b is installed) — restart nixmac.",
      "nixmac is waiting for a running activation to finish before updating the unattended sync helper (/nix/store/abc/activate submitted by the sync agent).",
      "nixmac is waiting for a running activation to finish before updating the unattended sync helper.",
      "nixmac couldn’t update the unattended sync helper. Try again. If this keeps happening, report the problem.",
    ]) {
      permissionsState.mockReturnValue(helperRow("pending", report));

      const { unmount } = await panel();

      expect(screen.getByText(report)).toBeTruthy();
      unmount();
    }
  });

  it("keeps the clicked action's button until it finishes", async () => {
    // Both actions record the decision before the run they start, so the
    // preference this row picks its button from flips while the run is still
    // going. The button must not: an Enable click that turned into "Disable"
    // mid-run would offer to undo an action still in flight, and the row would
    // be labelling the opposite of what was asked.
    helperPreference.mockReturnValue("unset");
    permissionsState.mockReturnValue(helperRow("pending", "a report"));
    let finishGrant: () => void = () => {};
    mockRequest.mockReturnValue(
      new Promise((resolve) => {
        finishGrant = () => resolve({ id: HELPER_PERMISSION_ID, status: "pending" });
      }),
    );

    const { getByRole, repaint } = await panel();
    fireEvent.click(getByRole("button", { name: "Enable" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Enabling/ })).toBeTruthy();
    });
    // The decision the click recorded, now mirrored back mid-run.
    helperPreference.mockReturnValue("granted");
    repaint();

    expect(screen.getByRole("button", { name: /Enabling/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Disable" })).toBeNull();

    finishGrant();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Enabling/ })).toBeNull();
    });
  });

  it("leaves another row's in-flight button alone", async () => {
    // The in-flight action is keyed by row for this: only the row that owns an
    // action is disabled, so a click on any other row is expected at any moment.
    // With one slot for the whole panel it would evict this row's, and the row
    // would fall back to the decision its own running Enable already recorded —
    // offering to disable a helper it is still enabling.
    helperPreference.mockReturnValue("unset");
    permissionsState.mockReturnValue(helperRow("pending", "a report", adminRow));
    mockRequest.mockReturnValue(new Promise(() => {}));

    const { getByRole } = await panel();
    fireEvent.click(getByRole("button", { name: "Enable" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Enabling/ })).toBeTruthy();
    });
    helperPreference.mockReturnValue("granted");
    // No `repaint` needed: this click starts the second row's action, and that
    // state change is the render which reads the flipped preference back.
    fireEvent.click(getByRole("button", { name: /Open Settings/ }));

    expect(screen.getByRole("button", { name: /Enabling/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Disable" })).toBeNull();
    // And the row that was clicked second reports its own action, not the first.
    expect(screen.getByRole("button", { name: /Waiting/ })).toBeTruthy();
  });

  it("keeps the label rendered while the action runs, and says the running word", async () => {
    // What fixes the button's width is that the idle label stays in the layout,
    // hidden, with the spinner over it. jsdom has no layout, so what is asserted
    // here is the testable half — the label is still rendered, and the running
    // word is the accessible name meanwhile, so the button is never nameless
    // while its label is hidden.
    helperPreference.mockReturnValue("granted");
    permissionsState.mockReturnValue(helperRow("granted", "installed and answering"));
    mockDisableHelper.mockReturnValue(new Promise(() => {}));

    const { getByRole } = await panel();
    fireEvent.click(getByRole("button", { name: "Disable" }));

    const running = await waitFor(() => screen.getByRole("button", { name: "Disabling…" }));
    expect(screen.getByText("Disable")).toBeTruthy();
    // The running label and `disabled` come from the same input, so a button
    // that says it is working cannot still be taking clicks.
    expect(running).toBeDisabled();
  });

  it("uses the live row after disabling, without retaining a stale RPC report", async () => {
    permissionsState.mockReturnValue(helperRow("granted", "installed and answering"));
    mockDisableHelper.mockResolvedValue({
      atThisBuild: false,
      phase: "waitingForActivation",
      detail: "nixmac is waiting for a running activation to finish before updating the unattended sync helper.",
    });

    const { getByRole, repaint } = await panel();
    fireEvent.click(getByRole("button", { name: "Disable" }));

    await waitFor(() => {
      expect(mockDisableHelper).toHaveBeenCalledTimes(1);
      expect(mockRefresh).toHaveBeenCalledTimes(2);
    });
    const removed = "The unattended sync helper is disabled and has been removed.";
    helperPreference.mockReturnValue("disabled");
    permissionsState.mockReturnValue({
      permissions: [helperPermission({ helperPhase: "disabled", instructions: removed })],
      allRequiredGranted: false,
      checkedAt: null,
    });
    repaint();

    expect(screen.getAllByText(removed)).toHaveLength(1);
    expect(screen.queryByText(/waiting for a running activation/)).toBeNull();
    expect(screen.getByRole("button", { name: "Enable" })).toBeEnabled();
  });

  it.each(["Enable", "Retry", "Disable"] as const)(
    "preserves a thrown %s error as a notice",
    async (action) => {
      helperPreference.mockReturnValue(action === "Enable" ? "unset" : "granted");
      permissionsState.mockReturnValue({
        permissions: [helperPermission({ helperPhase: "failed" })],
        allRequiredGranted: false,
        checkedAt: null,
      });
      const request = {
        Enable: mockRequest,
        Retry: mockRetryHelper,
        Disable: mockDisableHelper,
      }[action];
      request.mockRejectedValue(new Error("helper action transport failed"));

      await panel();
      fireEvent.click(screen.getByRole("button", { name: action }));

      await waitFor(() => expect(screen.getByText(/helper action transport failed/)).toBeTruthy());
    },
  );

  it("preserves App Management guidance when the helper row changes", async () => {
    const appManagement = {
      ...adminRow,
      id: "app-management",
      name: "App Management",
      instructions: "Allow nixmac to update managed apps.",
    };
    permissionsState.mockReturnValue(helperRow("pending", "a report", appManagement));
    mockRequest.mockResolvedValue({});

    const { repaint } = await panel();
    fireEvent.click(screen.getByRole("button", { name: /Open Settings/ }));
    await waitFor(() => expect(screen.getByText(/nixmac opened System Settings/)).toBeTruthy());

    permissionsState.mockReturnValue(helperRow("granted", "installed and answering", appManagement));
    repaint();
    expect(screen.getByText(/nixmac opened System Settings/)).toBeTruthy();
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(2), { timeout: 2000 });
  });
});
