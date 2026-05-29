import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  CHANGE_TYPE_STYLES,
  getDirectory,
  getShortFilename,
  type ChangeWithRichType,
} from "@/components/widget/utils";
import { useUiStore } from "@/stores/ui-store";
import { ChevronRight, Pencil } from "lucide-react";

interface CollapsibleDiffProps {
  change: ChangeWithRichType;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onToggle?: () => void;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}

export function CollapsibleDiff({
  change,
  open,
  defaultOpen,
  onOpenChange,
  onToggle,
  headerExtra,
  children,
}: CollapsibleDiffProps) {
  const { icon: Icon, iconColor } = CHANGE_TYPE_STYLES[change.changeType];
  const dir = getDirectory(change.filename);
  const name = getShortFilename(change.filename);

  return (
    <Collapsible
      className="rounded-md border border-border"
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      data-testid={`diff-row-${change.filename}`}
    >
      <div className="flex items-center gap-2 rounded-t-md bg-muted/50 px-2 py-1.5">
        <button
          type="button"
          className="group inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted"
          onClick={onToggle}
        >
          <ChevronRight className={`h-4 w-4 text-muted-foreground hover:text-foreground transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
        </button>
        <Icon className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <span className="min-w-0 truncate font-mono text-[11px]">
            {dir && <span className="text-neutral-500">{dir}/</span>}
            <span className="font-semibold text-neutral-200">{name}</span>
          </span>
          {headerExtra && (
            <div className="ml-2 flex shrink-0 items-center gap-1">{headerExtra}</div>
          )}
        </div>
        {change.changeType !== "removed" && (
          <button
            type="button"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              useUiStore.setState({ editingFile: change.filename });
            }}
            title="Edit file"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=open]:[animation-delay:50ms] data-[state=open]:[animation-fill-mode:backwards] data-[state=closed]:animate-collapsible-up">
        <div className="overflow-hidden border-border border-t">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
