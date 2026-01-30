import type { StepperStepId } from "@/components/widget/stepper";
import type {
  GitFileStatus,
  WidgetState,
  WidgetStep,
} from "@/stores/widget-store";
import { Pencil, Plus, Trash2 } from "lucide-react";

// Map widget steps to stepper steps
export function getStepperStep(step: WidgetStep): StepperStepId {
  switch (step) {
    case "permissions":
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

// Computes the current step based on widget state.

export function computeCurrentStep(state: WidgetState): WidgetStep {
  const hasConfigDir = !!state.configDir;
  const hasHost = !!state.host;
  const hasUncommittedChanges = state.gitStatus?.hasChanges ?? false;
  const allChangesCleanlyStaged =
    state.gitStatus?.allChangesCleanlyStaged ?? false;

  // Rule 0: Permissions not yet checked or not all required granted
  // Only show permissions step if we've checked and they're not granted
  if (
    state.permissionsChecked &&
    state.permissionsState &&
    !state.permissionsState.allRequiredGranted
  ) {
    return "permissions";
  }

  // Rule 1: Missing configuration
  if (!(hasConfigDir && hasHost)) {
    return "setup";
  }

  // Rule 2: Currently generating
  if (state.isGenerating) {
    return "evolving";
  }

  // Rule 3: All changes staged and ready to commit
  if (allChangesCleanlyStaged) {
    return "commit";
  }

  // Rule 4: Has uncommitted changes (not all staged yet)
  if (hasUncommittedChanges) {
    return "evolving";
  }

  // Rule 5: Default idle state
  return "overview";
}
