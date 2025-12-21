import { Pencil, Plus, Trash2 } from "lucide-react";
import type { GitFileStatus, WidgetStep } from "@/stores/widget-store";
import type { StepperStepId } from "./types";

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
  ): "new" | "edited" | "removed" | "renamed"
{
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
