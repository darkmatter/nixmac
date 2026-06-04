import { useWidgetStore } from "@/stores/widget-store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prefetchFileDiffContents } from "./use-git-operations";

const { mockFileDiffContents } = vi.hoisted(() => ({
  mockFileDiffContents: vi.fn(),
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    git: {
      fileDiffContents: (...args: unknown[]) => mockFileDiffContents(...args),
    },
  },
}));

vi.mock("@/hooks/use-widget-initialization", () => ({
  loadHosts: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const statusFor = (filename: string) => ({
  changes: [{ filename }],
});

const diffContents = (value: string) => ({
  original: `${value}:original`,
  modified: `${value}:modified`,
});

describe("prefetchFileDiffContents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWidgetStore.setState({ fileDiffContents: {} });
  });

  it("clears stale contents while fetching updated diffs", async () => {
    const pending = deferred<Record<string, ReturnType<typeof diffContents>>>();
    mockFileDiffContents.mockReturnValueOnce(pending.promise);
    useWidgetStore.setState({ fileDiffContents: { "flake.nix": diffContents("old") } });

    const prefetch = prefetchFileDiffContents(statusFor("flake.nix"));

    expect(useWidgetStore.getState().fileDiffContents).toEqual({});
    pending.resolve({ "flake.nix": diffContents("new") });
    await prefetch;

    expect(useWidgetStore.getState().fileDiffContents).toEqual({
      "flake.nix": diffContents("new"),
    });
  });

  it("ignores older requests that resolve after a newer prefetch", async () => {
    const older = deferred<Record<string, ReturnType<typeof diffContents>>>();
    const newer = deferred<Record<string, ReturnType<typeof diffContents>>>();
    mockFileDiffContents
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    const olderPrefetch = prefetchFileDiffContents(statusFor("flake.nix"));
    const newerPrefetch = prefetchFileDiffContents(statusFor("flake.nix"));

    newer.resolve({ "flake.nix": diffContents("new") });
    await newerPrefetch;
    expect(useWidgetStore.getState().fileDiffContents).toEqual({
      "flake.nix": diffContents("new"),
    });

    older.resolve({ "flake.nix": diffContents("old") });
    await olderPrefetch;
    expect(useWidgetStore.getState().fileDiffContents).toEqual({
      "flake.nix": diffContents("new"),
    });
  });

  it("stores per-file load failures instead of leaving diffs loading forever", async () => {
    mockFileDiffContents.mockRejectedValueOnce(new Error("diff read failed"));

    await prefetchFileDiffContents(statusFor("flake.nix"));

    expect(useWidgetStore.getState().fileDiffContents).toEqual({
      "flake.nix": null,
    });
  });
});
