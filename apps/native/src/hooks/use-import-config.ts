import { useState } from "react";
import type { ImportConfigResult } from "@/ipc/orpc-bindings";
import { applyImportResult } from "@/hooks/use-darwin-config";
import { client } from "@/lib/orpc";
import { onboardingActions } from "@nixmac/state";

export interface PendingFlakeChoice {
  /** Absolute directory holding the imported tree. */
  cloneDir: string;
  /** Flake directories relative to `cloneDir`, shallowest first. */
  flakeDirs: string[];
}

interface ImportConfigState {
  /** Set while an import waits for the user to pick a flake directory. */
  pending: PendingFlakeChoice | null;
  /** True while a choose/cancel call is in flight. */
  resolving: boolean;
  /** Routes an import result: finalized imports fire `onImported`, an
   * ambiguous one parks the pending choice for the chooser UI. */
  handleResult: (result: ImportConfigResult) => void;
  /** Finalizes the pending import with one of its flake directories. */
  choose: (flakeDir: string) => Promise<void>;
  /** Discards the pending import, freeing the target directory. */
  cancel: () => Promise<void>;
}

/**
 * Owns the "several flakes found — which one?" phase an import can enter
 * (`ImportConfigResult.needsFlakeDirChoice`), shared by every import surface.
 * `onImported` keeps its meaning of "a config directory was finalized".
 */
export function useImportConfig(onImported?: () => void): ImportConfigState {
  const [pending, setPending] = useState<PendingFlakeChoice | null>(null);
  const [resolving, setResolving] = useState(false);

  const handleResult = (result: ImportConfigResult) => {
    if (result.status === "needsFlakeDirChoice") {
      setPending({ cloneDir: result.cloneDir, flakeDirs: result.flakeDirs });
      // Mirrored into the onboarding store so "Restart setup" can discard the
      // pending tree: the backend keeps no record of it.
      onboardingActions.setPendingImportDir(result.cloneDir);
      return;
    }
    setPending(null);
    onboardingActions.setPendingImportDir(null);
    onImported?.();
  };

  const choose = async (flakeDir: string) => {
    if (!pending) return;
    setResolving(true);
    try {
      const result = await client.config.finalizeImport({
        cloneDir: pending.cloneDir,
        flakeDir,
      });
      await applyImportResult(result);
      handleResult(result);
    } finally {
      setResolving(false);
    }
  };

  const cancel = async () => {
    if (!pending) return;
    setResolving(true);
    try {
      await client.config.discardImport({ dir: pending.cloneDir });
    } finally {
      setPending(null);
      onboardingActions.setPendingImportDir(null);
      setResolving(false);
    }
  };

  return { pending, resolving, handleResult, choose, cancel };
}
