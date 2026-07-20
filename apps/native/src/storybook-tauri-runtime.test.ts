import { viewModelActions } from "@nixmac/state";
import { afterEach, describe, expect, it } from "vitest";

import { orpcHandlers } from "../.storybook/mocks/tauri-runtime";
import type { GitState, GitStatus } from "./ipc/types";

describe("Storybook Tauri oRPC mocks", () => {
  afterEach(() => {
    viewModelActions.reset();
  });

  it("handles editor.readFile for the nix editor", async () => {
    const content = (await orpcHandlers["editor.readFile"]?.({ relPath: "flake.nix" })) as
      | string
      | undefined;

    expect(content).toContain("darwinConfigurations");
  });

  // `git.state` mirrors the store verbatim (see the hydration comment in
  // .storybook/mocks/tauri-runtime.ts): an unset slice hydrates as null so
  // mounting the widget never clobbers what a story applied.
  it("hydrates git.state as null when no story seeded the git slice", async () => {
    const response = (await orpcHandlers["git.state"]?.(undefined)) as GitState | undefined;

    expect(response).toEqual({
      externalBuildDetected: false,
      upstreamUpdateAvailable: false,
      gitStatus: null,
    });
  });

  it("mirrors a story-applied git status back through git.state", async () => {
    const gitStatus: GitStatus = {
      files: [],
      branch: "main",
      diff: "",
      additions: 0,
      deletions: 0,
      headCommitHash: null,
      cleanHead: true,
      changes: [],
    };
    viewModelActions.patch({ git: gitStatus });

    const response = (await orpcHandlers["git.state"]?.(undefined)) as GitState | undefined;

    expect(response).toEqual({
      externalBuildDetected: false,
      upstreamUpdateAvailable: false,
      gitStatus,
    });
  });
});
