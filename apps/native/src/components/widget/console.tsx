"use client";

import { ChevronDown, ChevronUp } from "lucide-react";

interface ConsoleProps {
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  logs: string;
}

export function Console({ expanded, setExpanded, logs }: ConsoleProps) {
  return (
    <div className="flex flex-col border-border border-t">
      <button
        className="flex items-center justify-between px-4 py-2 text-muted-foreground text-xs transition-colors hover:bg-muted/50 hover:text-foreground"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <span className="font-medium">Console</span>
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronUp className="h-4 w-4" />
        )}
      </button>

      {expanded && (
        <div className="max-h-40 overflow-auto bg-black/40 p-3">
          <pre className="whitespace-pre-wrap font-mono text-[11px] text-green-300/90">
            {logs || "No output yet..."}
          </pre>
        </div>
      )}
    </div>
  );
}
