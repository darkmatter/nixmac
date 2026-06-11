import { useState } from "react";
import { Search } from "lucide-react";

import type { CandidateItem, FsFile } from "./data";
import { FileRow } from "./file-row";
import { UntrackedCard } from "./untracked-card";

interface FileListProps {
  files: FsFile[];
  /** Same handler the FileRow uses — the caller seeds the prompt and closes the view. */
  onEditWithPrompt: (file: FsFile) => void;
  /** Untracked sections route through this — caller seeds the prompt with a tracking task. */
  onTrack: (seed: string) => void;
  onTrackHomebrewCasks?: (items: CandidateItem[]) => Promise<void> | void;
}

export function FileList({
  files,
  onEditWithPrompt,
  onTrack,
  onTrackHomebrewCasks,
}: FileListProps) {
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = q
    ? files.filter((f) => {
        return (
          f.path.toLowerCase().includes(q) ||
          f.title.toLowerCase().includes(q) ||
          f.description.toLowerCase().includes(q)
        );
      })
    : files;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="shrink-0 border-border/50 border-b px-3 pt-2.5 pb-2">
        <div className="flex h-7 items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5">
          <Search className="h-3 w-3 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files…"
            className="flex-1 bg-transparent text-[11.5px] text-foreground outline-none placeholder:text-muted-foreground"
            data-testid="file-list-search"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="px-4 py-6 text-center text-[11px] text-muted-foreground">
            Nothing matches "{query}".
          </div>
        )}
        {filtered.map((f) =>
          f.status === "candidate" ? (
            <div key={f.id} className="border-border/50 border-b p-3">
              <UntrackedCard
                file={f}
                onTrack={onTrack}
                onTrackHomebrewCasks={onTrackHomebrewCasks}
              />
            </div>
          ) : (
            <FileRow key={f.id} file={f} onEditWithPrompt={onEditWithPrompt} />
          ),
        )}
      </div>
    </div>
  );
}
