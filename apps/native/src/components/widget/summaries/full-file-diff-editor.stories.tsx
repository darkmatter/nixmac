// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { useWidgetStore } from "@/stores/widget-store";
import type { ChangeWithRichType } from "@/components/widget/utils";
import type { FileDiffContents } from "@/types/shared";
import { useEffect, useState } from "react";
import { FullFileDiffEditor } from "./full-file-diff-editor";

function ControlledFullFileDiffEditor({
  initialOpen = false,
  ...props
}: Omit<React.ComponentProps<typeof FullFileDiffEditor>, "isOpen" | "onOpenChange"> & {
  initialOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(initialOpen);
  return <FullFileDiffEditor {...props} isOpen={isOpen} onOpenChange={setIsOpen} />;
}

const meta = preview.meta({
  title: "Widget/Summaries/FullFileDiffEditor",
  component: FullFileDiffEditor,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
});

export default meta;

// =============================================================================
// Mock data
// =============================================================================

const ORIGINAL = `{ config, pkgs, ... }:

{
  environment.systemPackages = with pkgs; [
    vim
    git
  ];

  services.nix-daemon.enable = true;
}`;

const MODIFIED = `{ config, pkgs, ... }:

{
  environment.systemPackages = with pkgs; [
    vim
    git
    ripgrep
    fd
    jq
  ];

  services.nix-daemon.enable = true;
  nix.settings.experimental-features = [ "nix-command" "flakes" ];
}`;

const DIFF_HEADER = `diff --git a/configuration.nix b/configuration.nix
--- a/configuration.nix
+++ b/configuration.nix
@@ -4,6 +4,9 @@
   environment.systemPackages = with pkgs; [
     vim
     git
+    ripgrep
+    fd
+    jq
   ];`;

const DIFF_HEADER_2 = `diff --git a/configuration.nix b/configuration.nix
--- a/configuration.nix
+++ b/configuration.nix
@@ -9,4 +12,5 @@
   services.nix-daemon.enable = true;
+  nix.settings.experimental-features = [ "nix-command" "flakes" ];
 }`;

function makeChange(id: number, diff: string): ChangeWithRichType {
  return {
    id,
    hash: `hash${id}`,
    filename: "configuration.nix",
    diff,
    lineCount: diff.split("\n").length,
    createdAt: Date.now(),
    ownSummaryId: null,
    changeType: "edited",
    shortFilename: "configuration.nix",
  };
}

const mockContents: FileDiffContents = {
  original: ORIGINAL,
  modified: MODIFIED,
};

const changeMap = {
  groups: [{
    summary: { id: 1, title: "Add CLI tools", description: "", status: "DONE", createdAt: 0 },
    changes: [{ hash: "hash1", title: "Add ripgrep, fd, jq", description: "", id: 1, filename: "configuration.nix", diff: "", lineCount: 0, createdAt: 0, ownSummaryId: null }],
  }],
  singles: [{ hash: "hash2", title: "Enable flakes", description: "", id: 2, filename: "configuration.nix", diff: "", lineCount: 0, createdAt: 0, ownSummaryId: null }],
  unsummarizedHashes: [],
};

function WithStore({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    useWidgetStore.getState().setChangeMap(changeMap);
  }, []);
  return <div className="w-[560px]">{children}</div>;
}

// =============================================================================
// Stories
// =============================================================================

export const SingleHunk = meta.story({
  render: () => (
    <WithStore>
      <ControlledFullFileDiffEditor
        filename="configuration.nix"
        changes={[makeChange(1, DIFF_HEADER)]}
        contents={mockContents}
        initialOpen
      />
    </WithStore>
  ),
});

export const MultipleHunks = meta.story({
  render: () => (
    <WithStore>
      <ControlledFullFileDiffEditor
        filename="configuration.nix"
        changes={[makeChange(1, DIFF_HEADER), makeChange(2, DIFF_HEADER_2)]}
        contents={mockContents}
        initialOpen
      />
    </WithStore>
  ),
});

export const Collapsed = meta.story({
  render: () => (
    <WithStore>
      <ControlledFullFileDiffEditor
        filename="configuration.nix"
        changes={[makeChange(1, DIFF_HEADER), makeChange(2, DIFF_HEADER_2)]}
        contents={mockContents}
      />
    </WithStore>
  ),
});

export const Loading = meta.story({
  render: () => (
    <WithStore>
      <ControlledFullFileDiffEditor
        filename="configuration.nix"
        changes={[makeChange(1, DIFF_HEADER)]}
        contents={undefined}
        initialOpen
      />
    </WithStore>
  ),
});
