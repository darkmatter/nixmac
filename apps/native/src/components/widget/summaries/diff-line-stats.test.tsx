import { describe, expect, it } from "vitest";
import { countDiffLineStats, sumDiffLineStats } from "./diff-line-stats";

describe("diff line stats", () => {
  it("counts added and removed hunk lines without counting file headers", () => {
    const diff = `diff --git a/configuration.nix b/configuration.nix
--- a/configuration.nix
+++ b/configuration.nix
@@ -1,4 +1,6 @@
 context
-old
+new
+another
 unchanged`;

    expect(countDiffLineStats(diff)).toEqual({ added: 2, removed: 1 });
  });

  it("counts new and removed files", () => {
    const newFile = `diff --git a/new.nix b/new.nix
--- /dev/null
+++ b/new.nix
@@ -0,0 +1,3 @@
+{
+  programs.git.enable = true;
+}`;

    const removedFile = `diff --git a/old.nix b/old.nix
--- a/old.nix
+++ /dev/null
@@ -1,3 +0,0 @@
-{
-  programs.fish.enable = true;
-}`;

    expect(countDiffLineStats(newFile)).toEqual({ added: 3, removed: 0 });
    expect(countDiffLineStats(removedFile)).toEqual({ added: 0, removed: 3 });
  });

  it("counts hunk content that resembles diff headers", () => {
    const diff = `@@ -1,2 +1,2 @@
---- actual removed content
+++ actual added content`;

    expect(countDiffLineStats(diff)).toEqual({ added: 1, removed: 1 });
  });

  it("sums stats across hunks", () => {
    const changes = [{ diff: "@@ -1 +1 @@\n-old\n+new" }, { diff: "@@ -5,0 +6,2 @@\n+one\n+two" }];

    expect(sumDiffLineStats(changes)).toEqual({ added: 3, removed: 1 });
  });
});
