"use client";

import { useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FlakeDirChooser } from "@/components/widget/controls/flake-dir-chooser";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { client } from "@/lib/orpc";

interface LocalSourceProps {
  onImported?: () => void;
}

interface PendingLocalChoice {
  folder: string;
  flakeDirs: string[];
}

/**
 * Pick a local folder holding a flake (real folder picker). The folder is
 * only selected as the config directory once a flake.nix is actually found —
 * at the folder root, in its single nested flake directory, or in the one the
 * user picks when there are several.
 */
export function LocalSource({ onImported }: LocalSourceProps) {
  const { setDir } = useDarwinConfig();
  const [browsing, setBrowsing] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [pending, setPending] = useState<PendingLocalChoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function selectDir(dir: string) {
    await setDir(dir);
    setPending(null);
    onImported?.();
  }

  async function browse() {
    setError(null);
    setBrowsing(true);
    try {
      const folder = await client.config.pickFolder();
      if (!folder) return;
      const flakeDirs = await client.flake.locate({ dir: folder });
      if (flakeDirs[0] === "") {
        // Flake at the folder root: the folder itself is the config dir.
        await selectDir(folder);
      } else if (flakeDirs.length === 1) {
        await selectDir(`${folder}/${flakeDirs[0]}`);
      } else if (flakeDirs.length === 0) {
        setError(
          `No flake.nix found in ${folder}. Pick the folder that contains your flake, or create a new configuration instead.`,
        );
      } else {
        setPending({ folder, flakeDirs });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBrowsing(false);
    }
  }

  async function choose(flakeDir: string) {
    if (!pending) return;
    setChoosing(true);
    try {
      await selectDir(`${pending.folder}/${flakeDir}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChoosing(false);
    }
  }

  if (pending) {
    // Nothing was cloned, so cancelling just forgets the selection.
    return (
      <FlakeDirChooser
        flakeDirs={pending.flakeDirs}
        onChoose={choose}
        onCancel={() => setPending(null)}
        busy={choosing}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-background px-6 py-10 text-center">
        <span
          className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          <FolderOpen className="size-6" />
        </span>
        <p className="mt-4 font-medium text-sm">Choose a local folder</p>
        <p className="mt-1 max-w-sm text-pretty text-muted-foreground text-sm">
          Select the folder that contains your <code className="font-mono">flake.nix</code> — it can
          also live in a subdirectory, we&apos;ll find it. Already cloned your dotfiles? This is the
          quickest option.
        </p>
        <Button className="mt-5" onClick={browse} disabled={browsing}>
          {browsing ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Opening Finder…
            </>
          ) : (
            <>
              <FolderOpen className="size-4" aria-hidden="true" />
              Browse…
            </>
          )}
        </Button>
        {error ? <p className="mt-3 text-destructive text-xs">{error}</p> : null}
      </div>
    </div>
  );
}
