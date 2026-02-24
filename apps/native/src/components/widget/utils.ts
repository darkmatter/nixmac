import type {
  GitFileStatus,
  WidgetState,
  WidgetStep,
} from "@/stores/widget-store";
import { Pencil, Plus, Trash2 } from "lucide-react";

export function categorizeChanges(files: GitFileStatus[]) {
  const categories = [
    {
      icon: Plus,
      title: "New Files",
      color: "teal" as const,
      items: [] as string[],
    },
    {
      icon: Pencil,
      title: "Modified",
      color: "blue" as const,
      items: [] as string[],
    },
    {
      icon: Trash2,
      title: "Removed",
      color: "red" as const,
      items: [] as string[],
    },
  ];

  for (const f of files) {
    const status = f.index || f.working_tree || "";
    const fileName = f.path.split("/").pop() || f.path;

    if (status === "A" || status === "?") {
      categories[0].items.push(fileName);
    } else if (status === "D") {
      categories[2].items.push(fileName);
    } else {
      categories[1].items.push(fileName);
    }
  }

  return categories.filter((c) => c.items.length > 0);
}

export function getChangeType(
  f: GitFileStatus,
): "new" | "edited" | "removed" | "renamed" {
  const status = f.index || f.working_tree || "";
  if (status === "A" || status === "?") {
    return "new";
  }
  if (status === "D") {
    return "removed";
  }
  if (status === "R") {
    return "renamed";
  }
  return "edited";
}

export function computeCurrentStep(state: WidgetState): WidgetStep {
  const hasConfigDir = !!state.configDir;
  const hasHost = !!state.host;
  const notMainBranch = !(state.gitStatus?.isMainBranch ?? true);
  const headIsBuilt = state.gitStatus?.headIsBuilt ?? false;
  const permissionsCheckedAndIncomplete =
    state.permissionsChecked &&
    state.permissionsState &&
    !state.permissionsState.allRequiredGranted;
  const isBootstrapping = state.isBootstrapping;

  if (permissionsCheckedAndIncomplete) {
    return "permissions";
  }

  if (state.nixInstalled === false || (state.nixInstalled === null && !state.nixInstalling)) {
    return "nix-setup";
  }

  if (state.nixInstalling) {
    return "nix-setup";
  }

  if (isBootstrapping) {
    return "setup";
  }

  if (!(hasConfigDir && hasHost)) {
    return "setup";
  }

  if (notMainBranch && headIsBuilt) {
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

/**
 * Converts a string into a URL-safe slug for branch names.
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