import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The helper row is the one permission nixmac installs rather than asks macOS
 * for, so it is the one row with two actions and a report to render. Everything
 * the row shows comes from the backend's reconciliation report: the status
 * decides Enable versus "Granted", Disable is offered either way, and
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
vi.mock("@nixmac/state", () => ({
  useViewModel: (select: (state: { permissions: unknown }) => unknown) =>
    select({ permissions: permissionsState() }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { bundlePath: null, inApplicationsDir: false } }),
}));

function helperRow(status: string, instructions: string) {
  return {
    permissions: [
      {
        id: "privileged-helper",
        name: "Unattended Sync Helper",
        description: "Required for unattended device sync",
        required: true,
        canRequestProgrammatically: true,
        status,
        instructions,
      },
    ],
    allRequiredGranted: status === "granted",
    checkedAt: null,
  };
}

async function panel() {
  const { PermissionsPanel } = await import("./permissions-panel");
  return render(<PermissionsPanel />);
}

describe("PermissionsPanel — the unattended sync helper row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefresh.mockResolvedValue(undefined);
  });

  it("offers Enable and shows the report while the helper is not granted", async () => {
    // Pending approval: a state, not a failure, and the sentence says where to
    // approve it.
    permissionsState.mockReturnValue(
      helperRow(
        "pending",
        "Approve nixmac in System Settings → General → Login Items & Extensions to finish enabling the unattended sync helper.",
      ),
    );

    await panel();

    expect(screen.getByRole("button", { name: "Enable" })).toBeTruthy();
    expect(screen.getByText(/Login Items & Extensions/)).toBeTruthy();
  });

  it("offers Disable in every state, granted or not", async () => {
    // A registration waiting for approval in Login Items reports a pending row,
    // and removing it is exactly what a user asks for there. Offering Disable
    // only on a granted row would leave that registration — and one this build
    // cannot use — with no way out but Enable, which records the opposite.
    for (const status of ["granted", "pending", "denied", "unknown"]) {
      permissionsState.mockReturnValue(helperRow(status, "a report"));

      const { unmount } = await panel();

      expect(screen.getByRole("button", { name: "Disable" })).toBeTruthy();
      unmount();
    }
  });

  it("renders every report the backend can send for a row that is not granted", async () => {
    // The vocabulary: move the app, restart it, wait out a running activation,
    // a possible interruption, and plain failures. Each arrives as the row's
    // instructions and is shown verbatim — the UI never re-words a report.
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

  it("does not offer Enable once the helper is granted", async () => {
    permissionsState.mockReturnValue(
      helperRow("granted", "The unattended sync helper is installed and answering."),
    );

    await panel();

    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
  });

  it("labels only the action that was clicked as running", async () => {
    // The two actions share one in-flight slot, so a Grant click must not put
    // the Disable button into "Disabling…" — the row would be claiming to do the
    // opposite of what was asked at the same time.
    permissionsState.mockReturnValue(helperRow("pending", "a report"));
    let finishGrant: () => void = () => {};
    mockRequest.mockReturnValue(
      new Promise((resolve) => {
        finishGrant = () => resolve({ id: "privileged-helper", status: "pending" });
      }),
    );

    const { getByRole } = await panel();
    fireEvent.click(getByRole("button", { name: "Enable" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Requesting/ })).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /Disabling/ })).toBeNull();
    expect(getByRole("button", { name: "Disable" })).toBeTruthy();

    finishGrant();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Requesting/ })).toBeNull();
    });
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
