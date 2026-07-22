import { configRelativePath } from "@/components/widget/utils";
import { useViewModel } from "@nixmac/state";

/**
 * Returns a mapper from git's repo-root-relative filenames to the
 * config-dir-relative form shown in the UI. Display-only: anything sent back
 * to the backend (discard, diff) must keep the repo-relative filename.
 */
export function useDisplayPath(): (filename: string) => string {
  const configDir = useViewModel((s) => s.preferences?.configDir ?? null);
  const repoRoot = useViewModel((s) => s.preferences?.repoRoot ?? null);
  return (filename) => configRelativePath(filename, configDir, repoRoot);
}
