import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useViewModel } from "@nixmac/state";
import { RepoImport } from "@/components/widget/controls/repo-import";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

type SetDirResult = { dir: string; changed: boolean };

const mockImportGithub = vi.fn<(ref: string, dir?: string) => Promise<SetDirResult>>();
const mockImportZip = vi.fn<(zip: string, dir?: string) => Promise<SetDirResult>>();
const mockPickZip = vi.fn<() => Promise<string | null>>();
const mockSetHostAttr = vi.fn<(h: string) => Promise<void>>();

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    config: {
      importGithub: (ref: string, dir?: string) => mockImportGithub(ref, dir),
      importZip: (zip: string, dir?: string) => mockImportZip(zip, dir),
      pickZip: () => mockPickZip(),
      setHostAttr: (h: string) => mockSetHostAttr(h),
    },
  },
}));

function resetMocks() {
  mockImportGithub.mockReset();
  mockImportZip.mockReset();
  mockPickZip.mockReset();
  mockSetHostAttr.mockReset();

  mockImportGithub.mockImplementation(async (_ref, dir) => ({
    dir: `/home/user/${dir ?? ".darwin"}`,
    changed: true,
  }));
  mockImportZip.mockImplementation(async (_zip, dir) => ({
    dir: `/home/user/${dir ?? ".darwin"}`,
    changed: true,
  }));
  mockPickZip.mockResolvedValue(null);
  mockSetHostAttr.mockResolvedValue();
}

beforeEach(() => {
  resetMocks();
  useViewModel.setState({ preferences: null, hosts: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("RepoImport", () => {
  it("imports a GitHub reference to the default .darwin directory", async () => {
    const onImported = vi.fn<() => void>();
    render(<RepoImport onImported={onImported} />);

    fireEvent.change(screen.getByLabelText("GitHub repository reference"), {
      target: { value: "czxtm/darwin" },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("import-repo-button"));
    });

    await waitFor(() => expect(mockImportGithub).toHaveBeenCalledWith("czxtm/darwin", ".darwin"));
    expect(onImported).toHaveBeenCalled();
  });

  it("blocks GitHub import when no reference is entered", async () => {
    render(<RepoImport />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("import-repo-button"));
    });

    expect(mockImportGithub).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter a GitHub reference/i)).toBeInTheDocument();
  });

  it("surfaces import errors", async () => {
    mockImportGithub.mockRejectedValue(new Error("clone failed"));
    render(<RepoImport />);

    fireEvent.change(screen.getByLabelText("GitHub repository reference"), {
      target: { value: "czxtm/darwin" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("import-repo-button"));
    });

    await waitFor(() => expect(screen.getByText("clone failed")).toBeInTheDocument());
  });
});
