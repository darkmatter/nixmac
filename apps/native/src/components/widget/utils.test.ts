import type { ChangeWithRichType } from "@/components/widget/utils";
import {
  categorizeRenamed,
  getModStartLine,
  inferChangeType,
  newFileContentFromDiffs,
  summarizeChangesByFile,
} from "@/components/widget/utils";
import { describe, expect, it } from "vitest";

function change(
  id: number,
  filename: string,
  changeType: ChangeWithRichType["changeType"],
  lineCount = 1,
  oldFilename?: string,
): ChangeWithRichType {
  return {
    id,
    hash: `hash-${id}`,
    filename,
    diff: `@@ -${id},1 +${id},1 @@`,
    lineCount,
    createdAt: 0,
    ownSummaryId: null,
    changeType,
    oldFilename,
    shortFilename: filename.split("/").pop() ?? filename,
  };
}

describe("summarizeChangesByFile", () => {
  it("collapses multiple hunks for the same file", () => {
    const summaries = summarizeChangesByFile([
      change(1, "flake.lock", "new", 4),
      change(2, "flake.lock", "removed", 6),
      change(3, "hosts/common/home.nix", "edited", 3),
    ]);

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      filename: "flake.lock",
      changeType: "edited",
      hunkCount: 2,
      lineCount: 10,
    });
    expect(summaries[1]).toMatchObject({
      filename: "hosts/common/home.nix",
      changeType: "edited",
      hunkCount: 1,
      lineCount: 3,
    });
  });

  it("keeps rename summaries separate by old and new path", () => {
    const summaries = summarizeChangesByFile([
      change(1, "modules/darwin/brew.nix", "renamed", 5, "modules/darwin/homebrew.nix"),
      change(2, "modules/darwin/brew.nix", "edited", 2),
    ]);

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      filename: "modules/darwin/brew.nix",
      oldFilename: "modules/darwin/homebrew.nix",
      changeType: "renamed",
      hunkCount: 1,
    });
    expect(summaries[1]).toMatchObject({
      filename: "modules/darwin/brew.nix",
      oldFilename: undefined,
      changeType: "edited",
      hunkCount: 1,
    });
  });
});

describe("inferChangeType", () => {
  it("classifies a hunk header with -0 as new", () => {
    expect(inferChangeType("@@ -0,0 +1,5 @@\n+foo")).toBe("new");
    expect(inferChangeType("@@ -0 +1 @@\n+foo")).toBe("new");
  });

  it("classifies a hunk header with +0 as removed", () => {
    expect(inferChangeType("@@ -1,5 +0,0 @@\n-foo")).toBe("removed");
  });

  it("classifies anything else as edited", () => {
    expect(inferChangeType("@@ -3,2 +3,2 @@\n-x\n+y")).toBe("edited");
  });
});

describe("categorizeRenamed", () => {
  function richChange(
    filename: string,
    changeType: ChangeWithRichType["changeType"],
    diff = `@@ -1,1 +1,1 @@ ${filename}`,
  ): ChangeWithRichType {
    return {
      id: 0,
      hash: `${filename}:${changeType}`,
      filename,
      diff,
      lineCount: 1,
      createdAt: 0,
      ownSummaryId: null,
      changeType,
      shortFilename: filename.split("/").pop() ?? filename,
    };
  }

  it("pairs a same-basename move into a single renamed entry", () => {
    const result = categorizeRenamed([
      richChange("modules/darwin/networking.nix", "removed"),
      richChange("modules/networking.nix", "new"),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      filename: "modules/networking.nix",
      oldFilename: "modules/darwin/networking.nix",
      changeType: "renamed",
    });
  });

  it("does not categorize an in-place rename (no remove + new pair) as renamed", () => {
    const result = categorizeRenamed([
      richChange("modules/darwin/networking.nix", "edited"),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      filename: "modules/darwin/networking.nix",
      changeType: "edited",
    });
    expect(result[0].oldFilename).toBeUndefined();
  });

  it("does not collapse when an ambiguous match exists (2 removes, 1 new)", () => {
    const inputs = [
      richChange("modules/darwin/networking.nix", "removed", "@@a"),
      richChange("modules/other/networking.nix", "removed", "@@b"),
      richChange("modules/networking.nix", "new", "@@c"),
    ];
    const result = categorizeRenamed(inputs);

    expect(result.find((c) => c.changeType === "renamed")).toBeUndefined();
    expect(result).toHaveLength(3);
  });
});

describe("getModStartLine", () => {
  it("returns the modified-side start line from a well-formed hunk header", () => {
    expect(getModStartLine("@@ -10,3 +12,4 @@\n context")).toBe(12);
    expect(getModStartLine("@@ -1 +5 @@\n x")).toBe(5);
  });

  it("returns 0 for a +0,0 header (no modified-side content)", () => {
    expect(getModStartLine("@@ -1,5 +0,0 @@")).toBe(0);
  });

  it("returns null for a malformed header", () => {
    expect(getModStartLine("not a diff")).toBeNull();
    expect(getModStartLine("@@ malformed @@")).toBeNull();
  });
});

describe("newFileContentFromDiffs", () => {
  it("reconstructs added content from a hunk-only new-file diff", () => {
    expect(newFileContentFromDiffs([
      "@@ -0,0 +1,4 @@\n+{ config, pkgs, ... }:\n+\n+{\n+  programs.zsh.enable = true;\n+}",
    ])).toBe("{ config, pkgs, ... }:\n\n{\n  programs.zsh.enable = true;\n}");
  });

  it("ignores diff metadata when reconstructing full new-file diffs", () => {
    expect(newFileContentFromDiffs([
      "diff --git a/modules/home/shell.nix b/modules/home/shell.nix\nnew file mode 100644\n--- /dev/null\n+++ b/modules/home/shell.nix\n@@ -0,0 +1,2 @@\n+line one\n+line two",
    ])).toBe("line one\nline two");
  });

  it("returns null for edited-file diffs", () => {
    expect(newFileContentFromDiffs([
      "@@ -3,2 +3,2 @@\n-old\n+new",
    ])).toBeNull();
  });
});
