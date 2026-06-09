import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { FILES } from "./data";
import { TRACK_ITEMS_FILES, TRACK_ITEMS_SNAPSHOT } from "./track-items";

type NixDarwinDocsEntry = {
  option_path: string;
};

const nixDarwinDocs = JSON.parse(
  readFileSync(
    new URL("../../../../src-tauri/resources/nix-darwin-docs.json", import.meta.url),
    "utf8",
  ),
) as NixDarwinDocsEntry[];

const docsOptionPaths = new Set(nixDarwinDocs.map((entry) => entry.option_path));

function readDocsMarkdown(docsPath: string): string {
  return readFileSync(
    new URL(`../../../../src-tauri/resources/options/${docsPath}`, import.meta.url),
    "utf8",
  );
}

describe("Track Items snapshot", () => {
  it("is the source for the filesystem manage section", () => {
    expect(FILES.manage).toBe(TRACK_ITEMS_FILES);
    expect(FILES.manage.map((file) => [file.id, file.title, file.items?.length])).toEqual([
      ["untracked-brew", "11 apps installed by hand", 11],
      ["custom-defaults", "8 untracked settings", 8],
      ["login-items", "4 apps auto-start at login", 4],
    ]);
  });

  it("derives Nix snippets from structured snapshot fields", () => {
    const [brew, defaults, loginItems] = TRACK_ITEMS_FILES;

    expect(brew.items?.[0]?.attr).toBe('homebrew.casks = [ "docker" ];');
    expect(defaults.items?.find((item) => item.name.includes("magnification"))?.attr).toBe(
      "system.defaults.dock.magnification = true;",
    );
    expect(defaults.items?.find((item) => item.name.includes("feedback"))?.attr).toBe(
      'system.defaults.NSGlobalDomain."com.apple.sound.beep.feedback" = 0;',
    );
    expect(loginItems.items?.find((item) => item.name === "1Password")?.attr).toBe(
      'launchd.user.agents."1password" = { ... };',
    );
  });

  it("points every nix-darwin source reference at the generated docs snapshot", () => {
    expect(TRACK_ITEMS_SNAPSHOT.sources.nixDarwinDocs).toBe(
      "apps/native/src-tauri/resources/nix-darwin-docs.json",
    );
    expect(TRACK_ITEMS_SNAPSHOT.sources.generatedBy).toBe("scripts/nix-options.sh");

    const sources = TRACK_ITEMS_FILES.flatMap((file) => [
      file.source,
      ...(file.items ?? []).map((item) => item.source),
    ]);

    for (const source of sources) {
      expect(source).toBeDefined();
      expect(docsOptionPaths.has(source?.optionPath ?? "")).toBe(true);

      const markdown = readDocsMarkdown(source?.docsPath ?? "");
      expect(markdown).toContain(`\`${source?.optionPath}\``);
    }
  });
});
