import { cn } from "@/lib/utils";
import { Braces } from "lucide-react";

export type FsMode = "plain" | "nix";

interface ModeToggleProps {
  mode: FsMode;
  setMode: (mode: FsMode) => void;
}

export function ModeToggle({ mode, setMode }: ModeToggleProps) {
  return (
    <div className="flex h-7 items-center rounded-md border border-border bg-card/60 p-0.5">
      {(["plain", "nix"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMode(m)}
          className={cn(
            "flex h-6 items-center gap-1 rounded-[5px] px-2 text-[11px] transition-colors",
            mode === m
              ? m === "nix"
                ? "bg-teal-500/15 font-medium text-teal-300"
                : "bg-secondary font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {m === "nix" && <Braces className="h-3 w-3" />}
          {m === "plain" ? "Plain" : "Nix"}
        </button>
      ))}
    </div>
  );
}
