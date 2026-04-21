import { Loader2 } from "lucide-react";
import { useRef } from "react";
import { cn } from "@/lib/utils";
import { useNixEditor } from "./use-nix-editor";

export interface NixEditorProps {
  filePath: string;
  onSave?: (content: string) => void;
  className?: string;
}

export function NixEditor({ filePath, onSave, className }: NixEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { isLoading, isDirty, error, lspStatus } = useNixEditor({
    filePath,
    containerRef,
    onSave,
  });

  return (
    <div className={cn("relative flex flex-1 flex-col overflow-hidden", className)}>
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive mx-4 mt-2 rounded border px-3 py-2 text-sm">
          {error}
        </div>
      )}
      <div className="absolute top-2 right-3 z-10 flex items-center gap-2">
        {lspStatus === "running" && (
          <div className="rounded bg-muted px-2 py-0.5 text-muted-foreground text-xs">
            nixd
          </div>
        )}
        {lspStatus === "error" && (
          <div className="rounded bg-destructive/10 px-2 py-0.5 text-destructive text-xs">
            nixd unavailable
          </div>
        )}
        {isDirty && (
          <div className="rounded bg-muted px-2 py-0.5 text-muted-foreground text-xs">
            Unsaved
          </div>
        )}
      </div>
      <div ref={containerRef} className="flex-1" />
    </div>
  );
}
