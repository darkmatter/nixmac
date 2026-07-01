import { describe, expect, it } from "vitest";

import { orpcHandlers } from "../.storybook/mocks/tauri-runtime";
import type { GitState } from "./ipc/types";

describe("Storybook Tauri oRPC mocks", () => {
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
});
