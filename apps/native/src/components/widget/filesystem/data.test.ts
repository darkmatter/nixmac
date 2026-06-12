import { describe, expect, it } from "vitest";

import { homebrewFilesFromDiff, untrackedCandidateItemCount, type FsFile } from "./data";

describe("untrackedCandidateItemCount", () => {
  it("counts only candidate items that would render in untracked cards", () => {
    const files: FsFile[] = [
      {
        id: "managed",
        path: "flake.nix",
        title: "Managed",
        description: "Tracked already",
        iconName: "wiring",
        tone: "muted",
        status: "managed",
        items: [{ name: "ignored", detail: "", installedAt: "", attr: "" }],
      },
      {
        id: "empty-candidate",
        path: "Empty",
        title: "Empty",
        description: "No drift",
        iconName: "warn",
        tone: "amber",
        status: "candidate",
        items: [],
      },
      {
        id: "candidate",
        path: "Candidate",
        title: "Candidate",
        description: "Real drift",
        iconName: "warn",
        tone: "amber",
        status: "candidate",
        items: [
          { name: "one", detail: "", installedAt: "", attr: "" },
          { name: "two", detail: "", installedAt: "", attr: "" },
        ],
      },
    ];

    expect(untrackedCandidateItemCount(files)).toBe(2);
  });

  it("matches the live Homebrew diff sections shown from the begin banner", () => {
    const files = homebrewFilesFromDiff({
      isInstalled: true,
      casks: ["docker", "obs"],
      brews: ["mas"],
      taps: [],
      source: null,
      lastChecked: 1,
    });

    expect(untrackedCandidateItemCount(files)).toBe(3);
  });
});
