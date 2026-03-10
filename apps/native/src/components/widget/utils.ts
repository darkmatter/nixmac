import type {
  WidgetState,
  WidgetStep,
} from "@/stores/widget-store";

export function computeCurrentStep(state: WidgetState): WidgetStep {
  const hasConfigDir = !!state.configDir;
  const hasHost = !!state.host;
  const notMainBranch = !(state.gitStatus?.isMainBranch ?? true);
  const headIsClean = state.gitStatus?.cleanHead ?? false;
  const headIsBuilt = state.gitStatus?.headIsBuilt ?? false;
  const permissionsCheckedAndIncomplete =
    state.permissionsChecked &&
    state.permissionsState &&
    !state.permissionsState.allRequiredGranted;
  const isBootstrapping = state.isBootstrapping;

  if (permissionsCheckedAndIncomplete) {
    return "permissions";
  }

  if (state.nixInstalled !== true || state.darwinRebuildAvailable !== true) {
    return "nix-setup";
  }

  if (isBootstrapping) {
    return "setup";
  }

  if (!(hasConfigDir && hasHost)) {
    return "setup";
  }

  if (state.showHistory) {
    return "history";
  }

  if (notMainBranch && headIsBuilt && headIsClean) {
    return "merge";
  }

  return "evolving";
}

export function getShortFilename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

export function getDirectory(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

export interface FileDiff {
  filename: string;
  chunks: string;
}

/**
 * Parse a unified diff into sections per file
 */
export function parseDiffIntoSections(diffContent: string): FileDiff[] {
  const sections: FileDiff[] = [];
  const lines = diffContent.split("\n");

  let currentFilename = "";
  let currentChunks: string[] = [];

  for (const line of lines) {
    const gitDiffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (gitDiffMatch) {
      if (currentFilename && currentChunks.length > 0) {
        sections.push({ filename: currentFilename, chunks: currentChunks.join("\n") });
      }
      currentFilename = gitDiffMatch[2];
      currentChunks = [];
      continue;
    }

    if (
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("index ") ||
      line.startsWith("new file mode") ||
      line.startsWith("deleted file mode")
    ) {
      continue;
    }

    if (currentFilename) {
      currentChunks.push(line);
    }
  }

  if (currentFilename && currentChunks.length > 0) {
    sections.push({ filename: currentFilename, chunks: currentChunks.join("\n") });
  }

  return sections;
}

/**
 * Infer change type from diff chunk content.
 */
export function getChangeTypeFromChunks(chunks: string): "new" | "edited" | "removed" {
  const contentLines = chunks.split("\n").filter((l) => l.startsWith("+") || l.startsWith("-"));
  if (contentLines.length === 0) return "edited";
  const hasAdditions = contentLines.some((l) => l.startsWith("+"));
  const hasDeletions = contentLines.some((l) => l.startsWith("-"));
  if (hasAdditions && !hasDeletions) return "new";
  if (!hasAdditions && hasDeletions) return "removed";
  return "edited";
}

/**
 * STILL USED IN APPLY, REMOVE ONCE FULLY IMPLEMENTED IN RUST CODE
 * Strips conventional commit prefixes (feat:, fix:, chore:, etc.)
 * and internal suffixes like "(manual changes)".
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/^\s*(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(\([^)]*\))?:\s*/i, "")
    .replace(/\s*\(manual changes\)\s*$/i, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}