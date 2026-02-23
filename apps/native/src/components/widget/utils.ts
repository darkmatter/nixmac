import type {
  WidgetState,
  WidgetStep,
} from "@/stores/widget-store";

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

  // Rule 0: Permission issues
  if (permissionsCheckedAndIncomplete) {
    return "permissions";
  }

  // Rule 0.5: Bootstrapping in progress - stay on setup step
  // This prevents git watcher updates from changing the step during bootstrap
  if (isBootstrapping) {
    return "setup";
  }

  // Rule 1: Missing configuration
  if (!(hasConfigDir && hasHost)) {
    return "setup";
  }

  // Rule 2: On nixmac-evolve/* branch with built tag → commit step
  if (notMainBranch && headIsBuilt) {
    return "merge";
  }

  // Rule 3: Default - evolving
  return "evolving";

  //TODO: add step for manual user branch unrelated to evolve workflow?
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