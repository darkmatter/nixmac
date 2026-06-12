import { describe, expect, it } from "vitest";

import {
  homebrewFilesFromDiff,
  replaceSystemDefaultsPlaceholder,
  systemDefaultsFileFromScan,
  untrackedCandidateItemCount,
  type FsFile,
} from "./data";

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

describe("systemDefaultsFileFromScan", () => {
  it("maps scanner defaults into untracked candidate items", () => {
    const file = systemDefaultsFileFromScan({
      totalScanned: 212,
      defaults: [
        {
          nixKey: "system.defaults.dock.magnification",
          label: "Enable Dock magnification",
          category: "Dock",
          currentValue: "1",
          defaultValue: "false",
        },
        {
          nixKey: "system.defaults.NSGlobalDomain.KeyRepeat",
          label: "Key repeat speed",
          category: "Keyboard",
          currentValue: "2",
          defaultValue: "6",
        },
      ],
    });

    expect(file.title).toBe("2 untracked macOS settings");
    expect(file.scanCommand).toBe("defaults read (212 known keys)");
    expect(file.items).toMatchObject([
      {
        name: "Dock - Enable Dock magnification",
        detail: "dock.magnification = 1",
        installedAt: "default: false",
        attr: "system.defaults.dock.magnification = true;",
      },
      {
        name: "Keyboard - Key repeat speed",
        detail: "NSGlobalDomain.KeyRepeat = 2",
        installedAt: "default: 6",
        attr: "system.defaults.NSGlobalDomain.KeyRepeat = 2;",
      },
    ]);
  });

  it("replaces only the custom defaults placeholder", () => {
    const replacement = systemDefaultsFileFromScan({ totalScanned: 0, defaults: [] });
    const files = replaceSystemDefaultsPlaceholder(
      [
        {
          id: "custom-defaults",
          path: "Custom macOS defaults",
          title: "placeholder",
          description: "",
          iconName: "settings",
          tone: "blue",
          status: "candidate",
          items: [{ name: "mock", detail: "", installedAt: "", attr: "" }],
        },
        {
          id: "login-items",
          path: "Login items",
          title: "Login items",
          description: "",
          iconName: "warn",
          tone: "amber",
          status: "candidate",
          items: [{ name: "kept", detail: "", installedAt: "", attr: "" }],
        },
      ],
      replacement,
    );

    expect(files[0].title).toBe("No untracked macOS defaults");
    expect(files[0].items).toEqual([]);
    expect(files[1].title).toBe("Login items");
  });
});
