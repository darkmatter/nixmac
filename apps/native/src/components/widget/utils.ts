import type { StepperStepId } from "@/components/widget/stepper";
import type { AppState, GitFileStatus, GitStatus, WidgetState, WidgetStep } from "@/stores/widget-store";
import { Pencil, Plus, Trash2 } from "lucide-react";

// Map widget steps to stepper steps
export function getStepperStep(step: WidgetStep): StepperStepId {
  switch (step) {
    case "setup":
    case "overview":
      return 1;
    case "evolving":
      return 2;
    case "commit":
      return 3;
    default:
      return 1;
  }
}

// Categorize git changes for display
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

// Helper to get change type from git status
export function getChangeType(
  f: GitFileStatus
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

/**
 * Analyze git status to determine what state changes are in.
 * - hasUnstagedChanges: Files with working_tree changes (not yet previewed)
 * - hasStagedChanges: Files with index changes (previewed/applied)
 * - allChangesStaged: All changes are staged (no unstaged changes exist)
 * - allChangesCleanlyStaged: All files are cleanly staged (staged with no working_tree modifications)
 *   This is the condition for showing the commit screen.
 */
export function analyzeGitStatus(gitStatus: GitStatus | null): {
  hasUnstagedChanges: boolean;
  hasStagedChanges: boolean;
  allChangesStaged: boolean;
  allChangesCleanlyStaged: boolean;
  unstagedFiles: GitFileStatus[];
  stagedFiles: GitFileStatus[];
  cleanlyStaged: GitFileStatus[];
} {
  const files = gitStatus?.files || [];
  const unstagedFiles = files.filter((f) => f.working_tree && f.working_tree !== " ");
  const stagedFiles = files.filter((f) => f.index && f.index !== " " && f.index !== "?");

  // Files that are cleanly staged (have index changes but no working_tree changes)
  const cleanlyStaged = files.filter(
    (f) =>
      f.index &&
      f.index !== " " &&
      f.index !== "?" &&
      (!f.working_tree || f.working_tree === " ")
  );

  return {
    hasUnstagedChanges: unstagedFiles.length > 0,
    hasStagedChanges: stagedFiles.length > 0,
    allChangesStaged: files.length > 0 && unstagedFiles.length === 0,
    allChangesCleanlyStaged: files.length > 0 && cleanlyStaged.length === files.length && stagedFiles.length > 0,
    unstagedFiles,
    stagedFiles,
    cleanlyStaged,
  };
}

/**
 * Computes the app state based on current conditions.
 * This is the client-side state machine - the server does NOT track this.
 *
 * Rules (in priority order):
 * 1. If missing configDir or host → Onboarding
 * 2. If generating → Generating
 * 3. If has uncommitted changes → Preview (shows evolving step)
 * 4. Otherwise → Idle
 */
export function computeAppState(state: WidgetState): AppState {
  const hasConfigDir = !!state.configDir;
  const hasHostAttr = !!state.host;
  const hasUncommittedChanges = state.gitStatus?.hasChanges ?? false;

  // Rule 1: Missing configuration
  if (!(hasConfigDir && hasHostAttr)) {
    return "onboarding";
  }

  // Rule 2: Currently generating
  if (state.isGenerating) {
    return "generating";
  }

  // Rule 3: Has uncommitted changes - show evolving step
  // (either pending preview or ready to commit)
  if (hasUncommittedChanges) {
    return "preview";
  }

  // Rule 4: Default idle state
  return "idle";
}

export function appStateToStep(
  state: AppState,
  gitStatus: GitStatus | null,
): WidgetStep {

  // Check if all changes are clearly staged before showing commit step when in preview state
  if (state === "preview") {
    const { allChangesCleanlyStaged } = analyzeGitStatus(gitStatus);
    return allChangesCleanlyStaged ? "commit" : "evolving";
  }

  switch (state) {
    case "onboarding":
      return "setup";
    case "generating":
      return "evolving";
    default:
      return "overview";
  }
}
