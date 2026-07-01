import { uiActions } from "@nixmac/state";
import type { FileDiffContents } from "@/ipc/types";
import { client } from "@/lib/orpc";
import { refreshGitSnapshot } from "@/viewmodel/git";
import { refreshHostsSnapshot } from "@/viewmodel/preferences";
import { toast } from "sonner";

/**
 * Hook for git operations.
 * Provides functions for refreshing git status changes.
 */
export const prefetchFileDiffContents = async (
  status: { changes: { filename: string }[] } | null,
) => {
  const setFileDiffContents = uiActions.setFileDiffContents;
  if (!status) {
    setFileDiffContents({});
    return;
  }
  const filenames = [...new Set(status.changes.map((c) => c.filename))];
  if (filenames.length === 0) {
    setFileDiffContents({});
    return;
  }
  try {
    const result = await client.git.fileDiffContents({ filenames });
    setFileDiffContents(compactFileDiffContents(result));
  } catch {
    setFileDiffContents({});
  }
};

function compactFileDiffContents(
  contents: Partial<Record<string, FileDiffContents>>,
): Record<string, FileDiffContents> {
  return Object.fromEntries(
    Object.entries(contents).filter((entry): entry is [string, FileDiffContents] => entry[1] != null),
  );
}

export const refreshGitStatus = async () => {
  try {
    await refreshGitSnapshot();
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    uiActions.setError(msg);
    await refreshHostsSnapshot();
  }
};

// runs on widget mount once, to get the current git status
const getInitialStatus = async () => {
  await refreshGitStatus();
};

const handleCommit = async ({ message }: { message: string }) => {
  uiActions.setProcessing(true, "merge");
  uiActions.appendLog(`\n> Committing changes...\n`);

  try {
    // The backend clears the evolve state, refreshes the git-state cell, and
    // resets the change-map cell; the `*_changed` events mirror everything.
    await client.git.commit({ message });
    uiActions.appendLog("✓ Committed successfully\n");
    uiActions.setError(null);
    toast.success("Committed successfully");
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    uiActions.setError(msg);
    uiActions.appendLog(`✗ Error: ${msg}\n`);
  } finally {
    uiActions.setProcessing(false);
  }
};

export function useGitOperations() {
  return { refreshGitStatus, getInitialStatus, handleCommit };
}
