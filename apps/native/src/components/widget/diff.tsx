import { cn } from "@/lib/utils";
import { SummaryState } from "@/stores/widget-store";
import { GitFileStatus } from "@/tauri-api";
import { ArrowLeft, Check, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";

interface DiffProps {
  summary: SummaryState;
  showAdvancedStats: boolean;
  changedFiles: GitFileStatus[];
  variant?: "default" | "outline";
}

export function Diff({ summary, showAdvancedStats, changedFiles, variant = "default" }: DiffProps) {
  // Helper to get change type from git status
  const getChangeType = (
    f: GitFileStatus
  ): "new" | "edited" | "removed" | "renamed" => {
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
  };

  // Helper to get filename from path
  const getFileName = (path: string) => {
    const parts = path.split("/");
    // biome-ignore lint/style/useAtIndex: ES2022 .at() not available
    return parts[parts.length - 1] || path;
  };

  // Helper to get directory from path
  const getDirectory = (path: string) => {
    const parts = path.split("/");
    if (parts.length <= 1) {
      return "";
    }
    return parts.slice(0, -1).join("/");
  };

  const renderListItem = ({
    key,
    changeType,
    fileName,
    directory,
    isStaged,
  }: {
    key: string;
    changeType: "new" | "edited" | "removed" | "renamed";
    fileName: string;
    directory?: string;
    isStaged?: boolean;
  }) => (
    <div
      className={cn("flex items-center gap-3  py-4 max-w-full", variant === "outline" && "border-border/50 border-b last:border-b-0")}
      key={key}
    >
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          changeType === "new" && "bg-green-500/15 text-green-400",
          changeType === "edited" && "bg-amber-500/15 text-amber-400",
          changeType === "removed" && "bg-red-500/15 text-red-400",
          changeType === "renamed" && "bg-blue-500/15 text-blue-400"
        )}
      >
        {changeType === "new" && <Plus className="h-4 w-4" />}
        {changeType === "edited" && <Pencil className="h-4 w-4" />}
        {changeType === "removed" && <Trash2 className="h-4 w-4" />}
        {changeType === "renamed" && <ArrowLeft className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{fileName}</p>
        {directory && (
          <p className="truncate text-muted-foreground text-xs">{directory}</p>
        )}
      </div>
      {isStaged && <Check className="h-4 w-4 shrink-0 text-green-400" />}
    </div>
  );

  // Use the structured summary items from the API
  const summaryItems: SummaryState["items"] = summary.items || [];

  return (
  <div className={cn("max-w-full shrink-0 rounded-lg flex flex-col max-h-[400px]", variant === "outline" && "border border-border")}>
    <div className="flex items-center gap-2 border-border/50 border-b py-2 shrink-0">
      <Sparkles className="h-4 w-4 text-primary" />
      <span className="font-medium text-sm">
        {showAdvancedStats ? "Files" : "What's Changed"}
      </span>
    </div>
    <div className="flex-1 overflow-y-auto min-h-0">
      {showAdvancedStats
        ? changedFiles.map((f) => {
            const changeType = getChangeType(f);
            const fileName = getFileName(f.path);
            const directory = getDirectory(f.path);
            const isStaged = Boolean(
              f.index && f.index !== " " && f.index !== "?"
            );

            return renderListItem({
              key: f.path,
              changeType,
              fileName,
              directory,
              isStaged,
            });
          })
        : summaryItems.map((item, index) =>
            renderListItem({
              key: `summary-${index}`,
              changeType: "edited",
              fileName: item.title,
              directory: item.description,
            })
          )}
    </div>
  </div>
  )
}