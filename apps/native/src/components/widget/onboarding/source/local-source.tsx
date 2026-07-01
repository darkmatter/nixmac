"use client";

import { useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDarwinConfig } from "@/hooks/use-darwin-config";

interface LocalSourceProps {
  onImported?: () => void;
}

/** Pick a local folder that already contains a flake.nix (real folder picker). */
export function LocalSource({ onImported }: LocalSourceProps) {
  const { pickDir } = useDarwinConfig();
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function browse() {
    setError(null);
    setBrowsing(true);
    try {
      const result = await pickDir();
      if (result) onImported?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBrowsing(false);
    }
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
          Select the folder that contains your <code className="font-mono">flake.nix</code>. Already
          cloned your dotfiles? This is the quickest option.
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
