import { useMemo, useState } from "react";
import { Braces, MessageSquarePlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { CandidateItem, FileTone, FsFile } from "./data";
import { highlightNixLine } from "./highlight";
import { resolveIcon } from "./icons";
import { seedForUntrackedItem, seedForUntrackedSection } from "./seed-prompt";

interface UntrackedCardProps {
  file: FsFile;
  /**
   * Called when the user clicks "Track these" or "Track <item>" — the
   * caller seeds the prompt and closes the Filesystem view.
   */
  onTrack: (seed: string) => void;
}

const CARD_TONE_CLASSES: Record<
  FileTone,
  { border: string; gradient: string; icon: string; divider: string }
> = {
  amber: {
    border: "border-amber-500/30",
    gradient: "from-amber-500/[0.06] to-amber-500/[0.02]",
    icon: "text-amber-400",
    divider: "border-amber-500/20",
  },
  blue: {
    border: "border-sky-500/30",
    gradient: "from-sky-500/[0.06] to-sky-500/[0.02]",
    icon: "text-sky-400",
    divider: "border-sky-500/20",
  },
  muted: {
    border: "border-border",
    gradient: "from-muted/40 to-muted/20",
    icon: "text-muted-foreground",
    divider: "border-border/40",
  },
  rose: {
    border: "border-rose-500/30",
    gradient: "from-rose-500/[0.06] to-rose-500/[0.02]",
    icon: "text-rose-400",
    divider: "border-rose-500/20",
  },
  teal: {
    border: "border-teal-500/30",
    gradient: "from-teal-500/[0.06] to-teal-500/[0.02]",
    icon: "text-teal-400",
    divider: "border-teal-500/20",
  },
};

export function UntrackedCard({ file, onTrack }: UntrackedCardProps) {
  const items = useMemo<CandidateItem[]>(() => file.items ?? [], [file.items]);
  const [showSource, setShowSource] = useState(false);
  const tone = CARD_TONE_CLASSES[file.tone];
  const Icon = resolveIcon(file.iconName);

  if (file.status !== "candidate") return null;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-gradient-to-b",
        tone.border,
        tone.gradient,
      )}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone.icon)} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[13px]">{file.title}</div>
          <div className="mt-1 text-[11.5px] text-muted-foreground leading-relaxed">
            {file.description}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[10.5px] text-muted-foreground">
            <span className="font-mono">$ {file.scanCommand}</span>
            <span>·</span>
            <span>{file.scannedAt}</span>
            <span>·</span>
            <span>
              would land in{" "}
              <span className="font-mono text-foreground">{file.destination}</span>
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Button
              size="sm"
              className="h-7 gap-1.5 bg-teal-500 text-[11px] text-background hover:bg-teal-400"
              onClick={() => onTrack(seedForUntrackedSection(file))}
              data-testid={`track-all-${file.id}`}
            >
              <MessageSquarePlus className="h-3 w-3" /> Track these {items.length}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-[11px]"
              onClick={() => setShowSource((v) => !v)}
              aria-expanded={showSource}
            >
              <Braces className="h-3 w-3" /> {showSource ? "Hide" : "Preview"} additions
            </Button>
          </div>
        </div>
      </div>

      <div className={cn("border-t bg-card/30", tone.divider)}>
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 px-3 py-1.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
          <span>·</span>
          <span>Found · {items.length}</span>
          <span />
        </div>
        <ul className="m-0 list-none p-0">
          {items.map((it, i) => (
            <li
              key={it.name}
              className={cn(
                "grid grid-cols-[1fr_auto_auto] items-center gap-2.5 px-3 py-2",
                i > 0 && "border-border/30 border-t",
              )}
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-[12px]">{it.name}</div>
                <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
                  {it.detail}
                </div>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">{it.installedAt}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10.5px] text-teal-300 hover:bg-teal-500/10 hover:text-teal-200"
                onClick={() => onTrack(seedForUntrackedItem(file, it))}
                data-testid={`track-item-${file.id}-${it.name}`}
              >
                Track
              </Button>
            </li>
          ))}
        </ul>
      </div>

      {showSource && (
        <pre className="m-0 max-h-[260px] overflow-auto whitespace-pre border-border/40 border-t bg-card/40 p-3 font-mono text-[11.5px] leading-[1.7]">
          {items.map((it) => (
            <span key={it.name} className="block bg-emerald-500/[0.06]">
              <span className="select-none pr-2 text-teal-400">+</span>
              <span className="text-muted-foreground"> </span>
              <span>{highlightNixLine(it.attr)}</span>
              <span className="ml-2 text-[10.5px] text-muted-foreground"># {it.name}</span>
            </span>
          ))}
        </pre>
      )}
    </div>
  );
}
