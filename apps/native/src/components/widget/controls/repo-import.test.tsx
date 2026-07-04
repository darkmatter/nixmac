import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RepoImport } from "@/components/widget/controls/repo-import";
import { viewModelActions } from "@nixmac/state";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

type ImportConfigResult =
  | {
      status: "imported";
      dir: string;
      changed: boolean;
      flakeDir: string | null;
    }
  | {
      status: "needsFlakeDirChoice";
      cloneDir: string;
      flakeDirs: string[];
    };

const mockImportGithub = vi.fn<(ref: string, dir?: string) => Promise<ImportConfigResult>>();
const mockImportZip = vi.fn<(zip: string, dir?: string) => Promise<ImportConfigResult>>();
const mockPickZip = vi.fn<() => Promise<string | null>>();
const mockSetHostAttr = vi.fn<(h: string) => Promise<void>>();
const mockFinalizeImport =
  vi.fn<(cloneDir: string, flakeDir: string) => Promise<ImportConfigResult>>();
const mockDiscardImport = vi.fn<(dir: string) => Promise<{ ok: boolean }>>();

vi.mock("@/lib/orpc", () => ({
  client: {
    config: {
      importGithub: ({ repoRef, dirName }: { repoRef: string; dirName: string | null }) =>
        mockImportGithub(repoRef, dirName ?? undefined),
      importZip: ({ zipPath, dirName }: { zipPath: string; dirName: string | null }) =>
        mockImportZip(zipPath, dirName ?? undefined),
      pickZip: () => mockPickZip(),
      setHostAttr: ({ host }: { host: string }) => mockSetHostAttr(host),
      finalizeImport: ({ cloneDir, flakeDir }: { cloneDir: string; flakeDir: string }) =>
        mockFinalizeImport(cloneDir, flakeDir),
      discardImport: ({ dir }: { dir: string }) => mockDiscardImport(dir),
    },
  },
}));

function resetMocks() {
  mockImportGithub.mockReset();
  mockImportZip.mockReset();
  mockPickZip.mockReset();
  mockSetHostAttr.mockReset();
  mockFinalizeImport.mockReset();
  mockDiscardImport.mockReset();
  mockFinalizeImport.mockImplementation(async (cloneDir, flakeDir) => ({
    status: "imported",
    dir: `${cloneDir}/${flakeDir}`,
    changed: true,
    flakeDir,
  }));
  mockDiscardImport.mockResolvedValue({ ok: true });

  mockImportGithub.mockImplementation(async (_ref, dir) => ({
    status: "imported",
    dir: `/home/user/${dir ?? ".darwin"}`,
    changed: true,
    flakeDir: null,
  }));
  mockImportZip.mockImplementation(async (_zip, dir) => ({
    status: "imported",
    dir: `/home/user/${dir ?? ".darwin"}`,
    changed: true,
    flakeDir: null,
  }));
  mockPickZip.mockResolvedValue(null);
  mockSetHostAttr.mockResolvedValue();
}

beforeEach(() => {
  resetMocks();
  viewModelActions.setState({ preferences: null, hosts: [] });
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

  it("offers a flake chooser when several candidates are found, then finalizes", async () => {
    const onImported = vi.fn<() => void>();
    mockImportGithub.mockResolvedValue({
      status: "needsFlakeDirChoice",
      cloneDir: "/home/user/.darwin",
      flakeDirs: ["nix/os", "machines/laptop"],
    });
    render(<RepoImport onImported={onImported} />);

    fireEvent.change(screen.getByLabelText("GitHub repository reference"), {
      target: { value: "arximboldi/dotfiles" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("import-repo-button"));
    });

    await waitFor(() => expect(screen.getByTestId("flake-dir-chooser")).toBeInTheDocument());
    expect(onImported).not.toHaveBeenCalled();

    // The shallowest candidate is preselected; confirming finalizes with it.
    await act(async () => {
      fireEvent.click(screen.getByTestId("flake-dir-chooser-confirm"));
    });

    await waitFor(() =>
      expect(mockFinalizeImport).toHaveBeenCalledWith("/home/user/.darwin", "nix/os"),
    );
    expect(onImported).toHaveBeenCalled();
  });

  it("discards the pending import when the chooser is cancelled", async () => {
    const onImported = vi.fn<() => void>();
    mockImportGithub.mockResolvedValue({
      status: "needsFlakeDirChoice",
      cloneDir: "/home/user/.darwin",
      flakeDirs: ["nix/os", "machines/laptop"],
    });
    render(<RepoImport onImported={onImported} />);

    fireEvent.change(screen.getByLabelText("GitHub repository reference"), {
      target: { value: "arximboldi/dotfiles" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("import-repo-button"));
    });
    await waitFor(() => expect(screen.getByTestId("flake-dir-chooser")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /cancel import/i }));
    });

    await waitFor(() => expect(mockDiscardImport).toHaveBeenCalledWith("/home/user/.darwin"));
    expect(onImported).not.toHaveBeenCalled();
    expect(screen.queryByTestId("flake-dir-chooser")).not.toBeInTheDocument();
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
