import { describe, expect, it } from "vitest";

import { orpcHandlers } from "../.storybook/mocks/tauri-runtime";
import type { GitState } from "./ipc/types";

describe("Storybook Tauri oRPC mocks", () => {
  it("handles editor.readFile for the nix editor", async () => {
    const content = (await orpcHandlers["editor.readFile"]?.({ relPath: "flake.nix" })) as
      | string
      | undefined;

    expect(content).toContain("darwinConfigurations");
  });

  it("handles git.state for widget hydration", async () => {
    const response = (await orpcHandlers["git.state"]?.(undefined)) as GitState | undefined;

    expect(response).toMatchObject({
      externalBuildDetected: false,
      gitStatus: {
        files: [],
        branch: "main",
        diff: "",
        additions: 0,
        deletions: 0,
        headCommitHash: null,
        cleanHead: true,
        changes: [],
      },
    });
  });

  it("handles model cache oRPC calls used by provider selectors", async () => {
    await orpcHandlers["models.setCached"]?.({
      provider: "claude",
      models: ["sonnet"],
    });

    expect(await orpcHandlers["models.getCached"]?.({ provider: "claude" })).toEqual(["sonnet"]);
    expect(await orpcHandlers["models.clearCached"]?.({ provider: "claude" })).toEqual({ ok: true });
    expect(await orpcHandlers["models.getCached"]?.({ provider: "claude" })).toBeNull();
  });
});
