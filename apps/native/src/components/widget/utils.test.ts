import type { ChangeWithRichType } from "@/components/widget/utils";
import { summarizeChangesByFile } from "@/components/widget/utils";
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
