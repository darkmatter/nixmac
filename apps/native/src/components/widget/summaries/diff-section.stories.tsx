// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import type { Change } from "@/ipc/types";
import { useState } from "react";
import { DiffSection } from "./diff-section";

function ControlledDiffSection({ changes }: { changes: Change[] }) {
  const [openFiles, setOpenFiles] = useState<Record<string, boolean>>({});
  return <DiffSection changes={changes} openFiles={openFiles} onOpenFilesChange={setOpenFiles} />;
}

const meta = preview.meta({
  title: "Widget/Summaries/DiffSection",
  component: DiffSection,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
});

export default meta;

// =============================================================================
// Mock data
// =============================================================================

function makeChange(id: number, filename: string, diff: string): Change {
  return {
    id,
    hash: `hash${id}`,
    filename,
    diff,
    lineCount: diff.split("\n").length,
    createdAt: Date.now(),
    ownSummaryId: null,
  };
}

const packagesDiff = `diff --git a/modules/darwin/packages.nix b/modules/darwin/packages.nix
--- a/modules/darwin/packages.nix
+++ b/modules/darwin/packages.nix
@@ -3,6 +3,8 @@
   environment.systemPackages = with pkgs; [
     vim
     git
+    ripgrep
+    fd
   ];`;

const shellDiff = `diff --git a/modules/home/shell.nix b/modules/home/shell.nix
new file mode 100644
--- /dev/null
+++ b/modules/home/shell.nix
@@ -0,0 +1,5 @@
+{ config, pkgs, ... }:
+{
+  programs.zsh.enable = true;
+  programs.starship.enable = true;
+}`;

const flakeDiff = `diff --git a/flake.nix b/flake.nix
--- a/flake.nix
+++ b/flake.nix
@@ -5,6 +5,7 @@
     nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
     darwin.url = "github:LnL7/nix-darwin/master";
+    home-manager.url = "github:nix-community/home-manager";
   };`;

// =============================================================================
// Stories
// =============================================================================

export const SingleFile = meta.story({
  render: () => (
    <div className="w-[560px]">
      <ControlledDiffSection changes={[makeChange(1, "modules/darwin/packages.nix", packagesDiff)]} />
    </div>
  ),
});

export const MultipleFiles = meta.story({
  render: () => (
    <div className="w-[560px]">
      <ControlledDiffSection
        changes={[
          makeChange(1, "modules/darwin/packages.nix", packagesDiff),
          makeChange(2, "modules/home/shell.nix", shellDiff),
          makeChange(3, "flake.nix", flakeDiff),
        ]}
      />
    </div>
  ),
});

export const Empty = meta.story({
  render: () => (
    <div className="w-[560px]">
      <ControlledDiffSection changes={[]} />
    </div>
  ),
});
