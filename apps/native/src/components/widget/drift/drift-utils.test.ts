import type { Change } from "@/ipc/types";
import { describe, expect, it } from "vitest";
import {
  type DriftFileRowData,
  deriveDriftFiles,
  formatDriftCounts,
  summarizeDriftCounts,
} from "./drift-utils";

function change(filename: string, diff: string, overrides: Partial<Change> = {}): Change {
  return {
    id: 0,
    hash: `${filename}:${diff.length}:${Math.abs(hashString(diff))}`,
    filename,
    diff,
    lineCount: diff.split("\n").length,
    createdAt: 0,
    ownSummaryId: 0,
    ...overrides,
  };
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const ADDED = "@@ -0,0 +1,3 @@\n+one\n+two\n+three";
const REMOVED = "@@ -1,3 +0,0 @@\n-one\n-two\n-three";
const EDITED = "@@ -1,2 +1,3 @@\n context\n-old\n+new-a\n+new-b";

// `categorizeRenamed` dedupes removed hunks by exact diff text, so distinct
// files in the same test must carry distinct diff bodies.
const added = (tag: string) => `@@ -0,0 +1,2 @@\n+${tag}-1\n+${tag}-2`;
const removed = (tag: string) => `@@ -1,2 +0,0 @@\n-${tag}-1\n-${tag}-2`;
const edited = (tag: string) => `@@ -1,2 +1,2 @@\n ${tag}\n-${tag}-old\n+${tag}-new`;

describe("deriveDriftFiles", () => {
  it("produces one row per file with the summed +/- line stats", () => {
    const rows = deriveDriftFiles([
      change("hosts/new.nix", ADDED),
      change("configuration.nix", EDITED),
    ]);

    expect(rows).toHaveLength(2);
    const byName = (name: string) => rows.find((r) => r.filename === name) as DriftFileRowData;

    expect(byName("hosts/new.nix").changeType).toBe("new");
    expect(byName("hosts/new.nix").stats).toEqual({ added: 3, removed: 0 });

    expect(byName("configuration.nix").changeType).toBe("edited");
    expect(byName("configuration.nix").stats).toEqual({ added: 2, removed: 1 });
  });

  it("keeps multiple changes to the same file as separate rows", () => {
    const rows = deriveDriftFiles([
      change("configuration.nix", EDITED),
      change("configuration.nix", ADDED),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.filename)).toEqual(["configuration.nix", "configuration.nix"]);
    expect(rows.map((row) => row.hunkCount)).toEqual([1, 1]);
    expect(rows.map((row) => row.stats)).toEqual([
      { added: 2, removed: 1 },
      { added: 3, removed: 0 },
    ]);
  });

  it("pairs an add + remove of the same basename into a single renamed row", () => {
    const rows = deriveDriftFiles([
      change("old/name.nix", REMOVED),
      change("new/name.nix", ADDED),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].changeType).toBe("renamed");
    expect(rows[0].filename).toBe("new/name.nix");
    expect(rows[0].oldFilename).toBe("old/name.nix");
  });

  it("carries the single hunk's diff as the row's diff text", () => {
    const rows = deriveDriftFiles([change("configuration.nix", EDITED)]);
    expect(rows[0].diffText).toBe(EDITED);
  });

  it("keeps each change's diff text with its own row", () => {
    const rows = deriveDriftFiles([
      change("configuration.nix", EDITED),
      change("configuration.nix", ADDED),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.diffText)).toEqual([EDITED, ADDED]);
  });

  it("returns nothing for an empty change set", () => {
    expect(deriveDriftFiles([])).toEqual([]);
  });
});

describe("summarizeDriftCounts / formatDriftCounts", () => {
  it("counts files by kind and folds renames into modified", () => {
    const rows = deriveDriftFiles([
      change("a/added.nix", added("a")),
      change("b/edited.nix", edited("b")),
      change("c/gone.nix", removed("c")),
      change("old/r.nix", removed("r")),
      change("new/r.nix", added("r")),
    ]);

    const counts = summarizeDriftCounts(rows);
    expect(counts).toEqual({ added: 1, modified: 2, removed: 1 });
    expect(formatDriftCounts(counts)).toBe("1 added · 2 modified · 1 removed");
  });

  it("omits zero categories", () => {
    expect(formatDriftCounts({ added: 0, modified: 3, removed: 0 })).toBe("3 modified");
  });
});
