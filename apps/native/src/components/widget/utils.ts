import type { StepperStepId } from "@/components/widget/stepper";
import type {
  GitFileStatus,
  WidgetState,
  WidgetStep,
} from "@/stores/widget-store";
import { Pencil, Plus, Trash2 } from "lucide-react";

// Map widget steps to stepper steps
// Step position is based on state: Begin (no changes) → Evolving (has changes) → Commit
export function getStepperStep(step: WidgetStep, hasChanges: boolean): StepperStepId {
  if (step === "commit") return 3;
  if (hasChanges) return 2; // "Evolving" - review changes
  return 1; // "Begin" - no changes yet
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
  const allChangesCleanlyStaged =
    state.gitStatus?.allChangesCleanlyStaged ?? false;
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

  // Rule 2: All changes staged and ready to commit
  if (allChangesCleanlyStaged) {
    return "commit";
  }

  // Rule 3: Default - evolving handles both idle and has-changes states
  return "evolving";
}
