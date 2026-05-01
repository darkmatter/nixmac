import { useMemo, useState } from "react";
import { AlertTriangle, Braces, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { FileOptions, FsFile } from "./data";
import { highlightNix, highlightNixLine } from "./highlight";
import type { FsMode } from "./mode-toggle";

interface DetailProps {
  file: FsFile | undefined;
  mode: FsMode;
  setMode: (mode: FsMode) => void;
}

export function Detail({ file, mode, setMode }: DetailProps) {
  if (!file) {
    return (
      <div className="p-6 text-center text-muted-foreground text-xs">
        Select an item to see details.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-border/50 border-b px-4 py-2.5">
        <div className="min-w-0">
          <div
            className={cn(
              "truncate font-medium text-[13px]",
              mode === "nix" ? "font-mono text-[12px]" : undefined,
            )}
          >
            {mode === "plain" ? file.plainTitle : file.path}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {mode === "plain" ? file.path : file.plainTitle}
          </div>
        </div>
        {mode === "plain" && file.nix && file.status !== "candidate" && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 border-teal-500/30 bg-teal-500/10 text-teal-300 text-[11px] hover:bg-teal-500/15 hover:text-teal-200"
            onClick={() => setMode("nix")}
          >
            <Braces className="h-3 w-3" /> Show me the nix
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === "plain" ? <PlainDetail file={file} /> : <NixDetail file={file} />}
      </div>
    </div>
  );
}

function PlainDetail({ file }: { file: FsFile }) {
  if (file.status === "candidate") return <CandidateView file={file} />;
  if (!file.options) {
    return (
      <div className="p-4 text-muted-foreground text-xs">
        No direct controls — open in editor to make changes.
      </div>
    );
  }
  return <PlainOptions options={file.options} />;
}

function PlainOptions({ options }: { options: FileOptions }) {
  if (options.kind === "toggles") {
    return (
      <div>
        {options.items.map((item) => (
          <ToggleRow key={item.key} item={item} />
        ))}
      </div>
    );
  }
  if (options.kind === "list") {
    return (
      <div className="py-1">
        <div className="px-4 py-1.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
          {options.label} · {options.items.length}
        </div>
        {options.items.map((it) => (
          <div
            key={it}
            className="grid grid-cols-[auto_1fr_auto] items-center gap-2.5 border-border/50 border-b px-4 py-2"
          >
            <span className="h-1 w-1 rounded-full bg-teal-400" />
            <span className="font-mono text-[12px]">{it}</span>
            <button
              type="button"
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="m-3 flex w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-md border border-border border-dashed px-3 py-2 text-[11.5px] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
        >
          <Plus className="h-3 w-3" /> {options.add}
        </button>
      </div>
    );
  }
  // summary
  return (
    <div className="grid gap-2 p-4">
      {options.rows.map(([k, v]) => (
        <div
          key={k}
          className="grid grid-cols-[120px_1fr] gap-3 rounded-md border border-border bg-card/40 px-3 py-2.5"
        >
          <div className="text-[11px] text-muted-foreground">{k}</div>
          <div className="text-xs">{v}</div>
        </div>
      ))}
    </div>
  );
}

function ToggleRow({ item }: { item: { key: string; label: string; value: boolean } }) {
  const [on, setOn] = useState(item.value);
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-border/50 border-b px-4 py-2.5">
      <div>
        <div className="text-[12.5px]">{item.label}</div>
        <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">{item.key}</div>
      </div>
      <button
        type="button"
        onClick={() => setOn(!on)}
        className={cn(
          "relative h-5 w-9 rounded-full transition-colors",
          on ? "bg-teal-500" : "bg-muted",
        )}
        aria-pressed={on}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
            on ? "left-[18px]" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}

function NixDetail({ file }: { file: FsFile }) {
  if (file.status === "candidate") return <CandidateNixView file={file} />;
  if (!file.nix) {
    return (
      <div className="p-4 text-muted-foreground text-xs">
        {file.readonly
          ? "Auto-generated lockfile — not edited by hand."
          : "No source preview available."}
      </div>
    );
  }
  return (
    <pre className="m-0 overflow-auto whitespace-pre p-4 font-mono text-[12px] leading-[1.6]">
      {highlightNix(file.nix)}
    </pre>
  );
}

function CandidateView({ file }: { file: FsFile }) {
  const items = useMemo(() => file.items ?? [], [file.items]);
  const [selected, setSelected] = useState(() => new Set(items.map((i) => i.name)));
  const allOn = selected.size === items.length;

  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
  };

  return (
    <div className="grid gap-3 p-4">
      <div className="rounded-lg border border-amber-500/30 bg-gradient-to-b from-amber-500/[0.08] to-amber-500/[0.04] px-3.5 py-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-[13px]">Not in your config yet</div>
            <div className="mt-1 text-[11.5px] text-muted-foreground leading-relaxed">
              {file.plainDesc}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[10.5px] text-muted-foreground">
              <span className="font-mono">$ {file.scanCommand}</span>
              <span>·</span>
              <span>{file.scannedAt}</span>
              <span>·</span>
              <span>
                would write to{" "}
                <span className="font-mono text-foreground">{file.destination}</span>
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Button
                size="sm"
                className="h-7 gap-1.5 bg-teal-500 text-[11px] text-background hover:bg-teal-400"
              >
                <Plus className="h-3 w-3" /> Start tracking {selected.size}{" "}
                {selected.size === 1 ? "item" : "items"}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px]">
                Preview diff
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground">
                Dismiss all
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
            Found · {items.length}
          </span>
          <button
            type="button"
            onClick={() =>
              setSelected(new Set(allOn ? [] : items.map((i) => i.name)))
            }
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            {allOn ? "Select none" : "Select all"}
          </button>
        </div>
        <div className="overflow-hidden rounded-md border border-border">
          {items.map((it, i) => {
            const on = selected.has(it.name);
            return (
              <label
                key={it.name}
                className={cn(
                  "grid cursor-pointer grid-cols-[auto_1fr_auto_auto] items-center gap-2.5 px-3 py-2",
                  i > 0 && "border-border/50 border-t",
                  on ? "bg-card/40" : "bg-card/10",
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(it.name)}
                  className="h-3.5 w-3.5 accent-teal-500"
                />
                <div className="min-w-0">
                  <div className={cn("font-medium text-[12px]", on ? "opacity-100" : "opacity-50")}>
                    {it.name}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
                    {it.detail}
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground">{it.installedAt}</span>
                <span
                  className={cn(
                    "rounded-sm border px-1.5 py-0.5 font-semibold text-[10px]",
                    on
                      ? "border-teal-500/40 bg-teal-500/15 text-teal-300"
                      : "border-border bg-transparent text-muted-foreground",
                  )}
                >
                  {on ? "tracking" : "skip"}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CandidateNixView({ file }: { file: FsFile }) {
  const items = file.items ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2.5 border-border/50 border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-sm border border-amber-500/40 border-dashed bg-amber-500/15 px-1.5 py-0.5 font-semibold text-[9.5px] text-amber-400 uppercase tracking-wider">
            Untracked
          </span>
          <span className="truncate text-[11.5px] text-muted-foreground">
            preview of {file.destination}
          </span>
        </div>
        <Button size="sm" className="h-7 gap-1.5 bg-teal-500 text-[11px] text-background hover:bg-teal-400">
          <Plus className="h-3 w-3" /> Start tracking
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <pre className="m-0 whitespace-pre p-4 font-mono text-[12px] leading-[1.7]">
          {items.map((it) => (
            <span key={it.name} className="block bg-emerald-500/[0.06]">
              <span className="select-none pr-2 text-teal-400">+</span>
              <span className="text-muted-foreground"> </span>
              <span>{highlightNixLine(it.attr)}</span>
              <span className="ml-2 text-[10.5px] text-muted-foreground"># {it.name}</span>
            </span>
          ))}
        </pre>
        <div className="flex flex-wrap gap-2 border-border/50 border-t px-4 py-2.5 text-[10.5px] text-muted-foreground">
          <span>{items.length} additions</span>
          <span>·</span>
          <span className="font-mono">$ {file.scanCommand}</span>
          <span>·</span>
          <span>{file.scannedAt}</span>
        </div>
      </div>
    </div>
  );
}
