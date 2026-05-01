import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

import type { FsFile } from "./data";
import { TONE_CLASSES } from "./data";
import { resolveIcon } from "./icons";
import type { FsMode } from "./mode-toggle";

interface FileListProps {
  files: FsFile[];
  selectedId: string | undefined;
  setSelected: (id: string) => void;
  mode: FsMode;
}

export function FileList({ files, selectedId, setSelected, mode }: FileListProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => {
      return (
        f.path.toLowerCase().includes(q) ||
        f.plainTitle.toLowerCase().includes(q) ||
        f.plainDesc.toLowerCase().includes(q)
      );
    });
  }, [files, query]);

  return (
    <div className="flex min-h-0 flex-col border-border/50 border-r">
      <div className="shrink-0 border-border/50 border-b px-3 pt-2.5 pb-2">
        <div className="flex h-7 items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5">
          <Search className="h-3 w-3 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === "plain" ? "Search settings…" : "Search files & attrs…"}
            className="flex-1 bg-transparent text-[11.5px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {filtered.map((f) => (
          <FileRow
            key={f.id}
            file={f}
            selected={selectedId === f.id}
            onClick={() => setSelected(f.id)}
            mode={mode}
          />
        ))}
        {filtered.length === 0 && (
          <div className="px-4 py-6 text-center text-[11px] text-muted-foreground">
            Nothing matches “{query}”.
          </div>
        )}
      </div>
    </div>
  );
}

interface FileRowProps {
  file: FsFile;
  selected: boolean;
  onClick: () => void;
  mode: FsMode;
}

function FileRow({ file, selected, onClick, mode }: FileRowProps) {
  const tone = TONE_CLASSES[file.tone];
  const Icon = resolveIcon(file.iconName);
  const title = mode === "plain" ? file.plainTitle : file.path;
  const sub =
    mode === "plain"
      ? file.plainDesc
      : `${file.plainTitle} · ${file.status === "candidate" ? "candidate" : file.status}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "grid w-full grid-cols-[auto_1fr] items-start gap-2.5 border-l-2 px-3 py-2 text-left transition-colors",
        selected
          ? "border-l-teal-500 bg-accent/60"
          : "border-l-transparent hover:bg-accent/30",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-6 w-6 items-center justify-center rounded-md",
          tone.bg,
          tone.fg,
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "truncate font-medium text-xs",
              mode === "nix" ? "font-mono text-[11.5px]" : undefined,
            )}
          >
            {title}
          </span>
          {file.status === "changed" && (
            <span className="rounded-sm bg-amber-500/15 px-1 py-px font-semibold text-[9.5px] text-amber-400">
              {file.changedNote ?? "changed"}
            </span>
          )}
          {file.status === "candidate" && (
            <span className="rounded-sm border border-amber-500/40 border-dashed bg-amber-500/10 px-1 py-px font-semibold text-[9.5px] text-amber-400">
              suggestion
            </span>
          )}
        </div>
        <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{sub}</div>
      </div>
    </button>
  );
}
