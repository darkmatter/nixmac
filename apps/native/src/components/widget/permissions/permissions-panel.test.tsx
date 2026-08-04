import type { Permission, PermissionStatus } from "@/ipc/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The helper row is the one permission nixmac installs rather than asks macOS
 * for, so it is the one row that can hand it back — as one button, a toggle of
 * the standing decision. Everything else the row shows comes from the backend's
 * reconciliation report: the status decides whether "Granted" is shown, and
 * `instructions` is the sentence.
 */

const mockRefresh = vi.fn();
const mockRequest = vi.fn();
const mockDisableHelper = vi.fn();

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    permissions: {
      refresh: (...args: unknown[]) => mockRefresh(...args),
      request: (...args: unknown[]) => mockRequest(...args),
      requestFullDiskAccess: vi.fn(),
    },
  },
}));

vi.mock("@/lib/orpc", () => ({
  client: {
    darwin: {
      helperDisable: (...args: unknown[]) => mockDisableHelper(...args),
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

const permissionsState = vi.fn();
const helperPreference = vi.fn();
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

const APPROVE_IN_LOGIN_ITEMS =
  "Approve nixmac in System Settings → General → Login Items & Extensions to finish enabling the unattended sync helper.";

function helperPermission(overrides: Partial<Permission>) {
  return {
    id: "privileged-helper",
    name: "Unattended Sync Helper",
    description: "Required for unattended device sync",
    required: true,
    canRequestProgrammatically: true,
    status: "pending",
    instructions: "a report",
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

  it("opens Login Items through the same grant action the row always used", async () => {
    // The deep link is not a new backend call: it is `permissions.request` for
    // this row, which records the decision and reconciles, and is the only action
    // allowed to open Login Items. In this state it opens them before it
    // reconciles at all — the registration is already waiting for approval, so
    // the pane does not depend on what the run goes on to report.
    helperPreference.mockReturnValue("granted");
    permissionsState.mockReturnValue(awaitingApprovalRow());
    mockRequest.mockResolvedValue({ id: "privileged-helper", status: "pending" });

    const { getByRole } = await panel();
    fireEvent.click(getByRole("button", { name: /Open Settings/ }));

    await waitFor(() => {
      expect(mockRequest).toHaveBeenCalledWith("privileged-helper");
      expect(mockRefresh).toHaveBeenCalled();
    });
    expect(mockDisableHelper).not.toHaveBeenCalled();
  });

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

  it("renders every report the backend can send for a row that is not granted", async () => {
    // The vocabulary: move the app, restart it, wait out a running activation, a
    // possible interruption, and plain failures. Each arrives as the row's
    // instructions and is shown verbatim — the UI never re-words a report. All of
    // them are reachable with the helper wanted, which is what this row is. The
    // sixth report, approval pending, comes with a row of its own and is asserted
    // in the Login Items test above.
    helperPreference.mockReturnValue("granted");
    for (const report of [
      "nixmac runs from /Volumes/nixmac/nixmac.app — move it to /Applications.",
      "this app was replaced while running (build a is running, b is installed) — restart nixmac.",
      "nixmac is still reconciling the unattended sync helper: waiting for a running activation to finish (/nix/store/abc/activate submitted by the sync agent).",
      "the helper process ended while running /nix/store/abc/activate — that activation may have been interrupted and the system may be partially changed.",
      "the helper could not be unregistered: SMAppService 1 refused.",
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
        finishGrant = () => resolve({ id: "privileged-helper", status: "pending" });
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

  it("disabling reports what the run did and re-probes", async () => {
    permissionsState.mockReturnValue(helperRow("granted", "installed and answering"));
    mockDisableHelper.mockResolvedValue({
      atThisBuild: false,
      detail: "The unattended sync helper is disabled and has been removed.",
    });

    const { getByRole } = await panel();
    fireEvent.click(getByRole("button", { name: "Disable" }));

    await waitFor(() => {
      expect(mockDisableHelper).toHaveBeenCalledTimes(1);
      expect(mockRefresh).toHaveBeenCalled();
    });
    expect(screen.getByText("The unattended sync helper is disabled and has been removed.")).toBeTruthy();
  });
});
