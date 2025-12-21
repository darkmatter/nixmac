import {
  Check,
  Clock,
  History,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FileChange {
  name: string;
  type: "new" | "edited" | "removed";
  description: string;
  timeAgo: string;
}

const mockChanges: FileChange[] = [
  {
    name: "Database Settings",
    type: "edited",
    description: "Updated connection details",
    timeAgo: "2 min ago",
  },
  {
    name: "API Configuration",
    type: "edited",
    description: "Changed server address",
    timeAgo: "5 min ago",
  },
  {
    name: "Activity Logger",
    type: "new",
    description: "New feature added",
    timeAgo: "12 min ago",
  },
  {
    name: "Old Settings",
    type: "removed",
    description: "Cleaned up unused file",
    timeAgo: "15 min ago",
  },
];

export function GitWidget() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedChange, setSelectedChange] = useState<FileChange | null>(null);
  const [prompt, setPrompt] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const handlePromptSubmit = () => {
    if (!prompt.trim()) {
      return;
    }
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      setPrompt("");
    }, 2000);
  };

  return (
    <>
      <button
        className={cn(
          "fixed right-6 bottom-6 h-14 rounded-2xl px-5",
          "border-2 border-border bg-card",
          "flex items-center gap-3",
          "transition-all duration-300 hover:scale-105 hover:border-primary/50",
          "shadow-2xl shadow-black/50",
          isExpanded && "pointer-events-none scale-95 opacity-0"
        )}
        onClick={() => setIsExpanded(true)}
        type="button"
      >
        <div className="relative">
          <Clock className="h-5 w-5 text-primary" />
          {mockChanges.length > 0 && (
            <div className="-top-1 -right-1 absolute h-3 w-3 animate-pulse rounded-full bg-accent" />
          )}
        </div>
        <div className="flex flex-col items-start">
          <span className="font-medium text-muted-foreground text-xs">
            Ready to save
          </span>
          <span className="font-semibold text-sm">
            {mockChanges.length} changes
          </span>
        </div>
      </button>

      <div
        className={cn(
          "fixed right-6 bottom-6 w-[400px] overflow-hidden rounded-3xl",
          "border-2 border-border bg-card",
          "shadow-2xl shadow-black/50",
          "origin-bottom-right transition-all duration-500",
          isExpanded
            ? "pointer-events-auto scale-100 opacity-100"
            : "pointer-events-none scale-90 opacity-0"
        )}
      >
        <div className="flex items-center justify-between border-border border-b bg-gradient-to-r from-primary/5 to-transparent p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10">
              <History className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">Unsaved Changes</h3>
              <p className="text-muted-foreground text-sm">
                {mockChanges.length} items ready to save
              </p>
            </div>
          </div>
          <Button
            className="h-9 w-9 rounded-xl hover:bg-muted"
            onClick={() => {
              setIsExpanded(false);
              setSelectedChange(null);
            }}
            size="icon"
            variant="ghost"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="max-h-[300px] overflow-y-auto">
          {mockChanges.map((change) => (
            <button
              className={cn(
                "flex w-full items-center gap-4 p-4",
                "transition-all duration-200 hover:bg-muted/50",
                "border-border/50 border-b last:border-b-0",
                selectedChange?.name === change.name && "bg-muted"
              )}
              key={change.name}
              onClick={() => setSelectedChange(change)}
              type="button"
            >
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                  change.type === "new" && "bg-git-added/15 text-git-added",
                  change.type === "edited" &&
                    "bg-git-modified/15 text-git-modified",
                  change.type === "removed" &&
                    "bg-git-deleted/15 text-git-deleted"
                )}
              >
                {change.type === "new" && <Plus className="h-5 w-5" />}
                {change.type === "edited" && <Pencil className="h-5 w-5" />}
                {change.type === "removed" && <Trash2 className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate font-medium">{change.name}</p>
                <p className="truncate text-muted-foreground text-sm">
                  {change.description}
                </p>
              </div>
              <span className="whitespace-nowrap text-muted-foreground text-xs">
                {change.timeAgo}
              </span>
            </button>
          ))}
        </div>

        {selectedChange && (
          <div className="border-border border-t bg-muted/30 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <p className="font-medium text-sm">What changed</p>
            </div>
            <div className="space-y-2 rounded-xl bg-background p-4 text-sm">
              <div className="flex items-center gap-2 text-git-deleted">
                <span className="rounded-md bg-git-deleted/10 px-2 py-0.5 text-xs">
                  Before
                </span>
                <span className="opacity-75">Old configuration value</span>
              </div>
              <div className="flex items-center gap-2 text-git-added">
                <span className="rounded-md bg-git-added/10 px-2 py-0.5 text-xs">
                  After
                </span>
                <span>New improved setting</span>
              </div>
            </div>
          </div>
        )}

        <div className="border-border border-t bg-gradient-to-r from-primary/5 to-accent/5 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <p className="font-medium text-sm">Make an update</p>
          </div>
          <div className="relative">
            <input
              className={cn(
                "h-12 w-full rounded-xl pr-12 pl-4",
                "border-2 border-border bg-background",
                "text-sm placeholder:text-muted-foreground",
                "focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20",
                "transition-all duration-200",
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
              disabled={isProcessing}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handlePromptSubmit()}
              placeholder="Describe what you want to change..."
              type="text"
              value={prompt}
            />
            <Button
              className={cn(
                "-translate-y-1/2 absolute top-1/2 right-2",
                "h-8 w-8 rounded-lg",
                "bg-primary hover:bg-primary/90",
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
              disabled={!prompt.trim() || isProcessing}
              onClick={handlePromptSubmit}
              size="icon"
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="mt-2 text-muted-foreground text-xs">
            Try: "Update the database timeout to 30 seconds"
          </p>
        </div>

        <div className="border-border border-t p-4">
          <div className="flex items-center gap-3">
            <Button
              className="h-11 flex-1 gap-2 bg-transparent hover:border-git-deleted/50 hover:bg-git-deleted/10 hover:text-git-deleted"
              onClick={() => console.log("Undo clicked")}
              variant="outline"
            >
              <RotateCcw className="h-4 w-4" />
              Undo All
            </Button>
            <Button
              className="h-11 flex-1 gap-2 bg-primary hover:bg-primary/90"
              onClick={() => console.log("Save clicked")}
            >
              <Check className="h-4 w-4" />
              Save Changes
            </Button>
          </div>
          <p className="mt-3 text-center text-muted-foreground text-xs">
            Your changes will be saved as a new version
          </p>
        </div>
      </div>
    </>
  );
}
