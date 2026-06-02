import type { NixInstallEndEvent } from "@/ipc/types";
import { describe, expect, it, vi } from "vitest";
import { getNixInstallErrorMessage } from "./use-nix-install";

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    nix: {
      check: vi.fn(),
      installStart: vi.fn(),
      prefetchDarwinRebuild: vi.fn(),
    },
  },
  ipcRenderer: {
    on: vi.fn(),
  },
}));

vi.mock("@/stores/widget-store", () => ({
  useWidgetStore: {
    getState: vi.fn(),
  },
}));

function installEndPayload(
  overrides: Partial<NixInstallEndEvent>,
): NixInstallEndEvent {
  return {
    ok: false,
    code: -1,
    nix_version: null,
    darwin_rebuild_available: null,
    error_type: null,
    error: null,
    ...overrides,
  };
}

describe("getNixInstallErrorMessage", () => {
  it("adds retry and manual install guidance for download failures", () => {
    const message = getNixInstallErrorMessage(
      installEndPayload({
        error_type: "download_failed",
        error: "Failed to download Nix installer: network error",
      }),
    );

    expect(message).toContain("network error");
    expect(message).toContain("try again");
    expect(message).toContain("https://determinate.systems/nix-installer/");
  });

  it("uses native admin prompt guidance for installer failures without details", () => {
    const message = getNixInstallErrorMessage(
      installEndPayload({
        error_type: "installer_failed",
      }),
    );

    expect(message).toContain("native admin prompt");
    expect(message).toContain("install Nix manually");
  });

  it("preserves backend cancellation copy when provided", () => {
    const message = getNixInstallErrorMessage(
      installEndPayload({
        error_type: "installer_failed",
        error: "Nix installation was cancelled. Retry the install and approve the macOS administrator prompt.",
      }),
    );

    expect(message).toContain("cancelled");
    expect(message).toContain("administrator prompt");
  });

  it("suggests checking for an open prompt on timeout", () => {
    const message = getNixInstallErrorMessage(
      installEndPayload({
        error_type: "timeout",
      }),
    );

    expect(message).toContain("installer prompt");
    expect(message).toContain("retry");
  });
});
