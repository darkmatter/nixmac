import { useMemo, useState } from "react";
import { Check, ChevronDown, Plus, Search } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import type { Host } from "./data";

interface HostsComboboxProps {
  hosts: Host[];
  selected: Set<string>;
  setSelected: (next: Set<string>) => void;
  variant?: "chip" | "inline";
}

function shortName(h: Host) {
  return h.name
    .replace(/^Farhans-/, "")
    .replace(/-MacBook-Pro-26$/, "-MBP")
    .replace(/-MacBook-Pro$/, "-MBP");
}

export function HostsCombobox({ hosts, selected, setSelected, variant = "chip" }: HostsComboboxProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const total = hosts.length;
  const sel = useMemo(() => hosts.filter((h) => selected.has(h.id)), [hosts, selected]);
  const allSelected = sel.length === total && total > 0;
  const noneSelected = sel.length === 0;
  const onlyCurrent = sel.length === 1 && sel[0].current;

  const label = (() => {
    if (allSelected) return `All hosts · ${total}`;
    if (noneSelected) return "No hosts";
    if (onlyCurrent) return "This Mac";
    if (sel.length === 1) return sel[0].name;
    if (sel.length <= 2) return sel.map(shortName).join(" + ");
    return `${sel.length} of ${total} hosts`;
  })();

  const anyDirty = sel.some((h) => h.state === "dirty");
  const includesCurrent = sel.some((h) => h.current);
  const dotClass = noneSelected
    ? "bg-muted-foreground"
    : anyDirty
      ? "bg-amber-400"
      : includesCurrent
        ? "bg-teal-400"
        : "bg-muted-foreground";

  const filtered = useMemo(
    () => hosts.filter((h) => h.name.toLowerCase().includes(filter.toLowerCase())),
    [hosts, filter],
  );

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 rounded-md border border-border bg-card/60 text-foreground transition-colors hover:bg-card",
            variant === "chip" ? "h-7 px-2.5 text-xs" : "h-6 px-2 text-[11px]",
          )}
        >
          {variant === "inline" && (
            <span className="text-[10px] text-muted-foreground">Scope</span>
          )}
          <span className={cn("h-1.5 w-1.5 rounded-full", dotClass)} />
          <span className="font-medium">{label}</span>
          <ChevronDown className={cn(variant === "chip" ? "h-3 w-3" : "h-2.5 w-2.5", "text-muted-foreground")} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-1.5">
        <div className="flex items-center justify-between px-2 pt-1 pb-1">
          <span className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
            Hosts
          </span>
          <span className="text-[10px] text-muted-foreground">
            {sel.length} of {total}
          </span>
        </div>
        <div className="mx-1.5 mb-1.5 flex h-7 items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5">
          <Search className="h-3 w-3 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter hosts…"
            className="flex-1 bg-transparent text-[11.5px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-[220px] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-3 text-center text-[11px] text-muted-foreground">No hosts match.</div>
          ) : (
            filtered.map((h) => {
              const checked = selected.has(h.id);
              const dot = h.state === "dirty"
                ? "bg-amber-400"
                : h.current
                  ? "bg-teal-400"
                  : "bg-muted-foreground";
              return (
                <button
                  type="button"
                  key={h.id}
                  onClick={() => toggle(h.id)}
                  className="grid w-full grid-cols-[auto_auto_1fr_auto] items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-accent"
                >
                  <span
                    className={cn(
                      "flex h-3.5 w-3.5 items-center justify-center rounded-sm border",
                      checked
                        ? "border-teal-500 bg-teal-500 text-background"
                        : "border-border bg-transparent",
                    )}
                  >
                    {checked && <Check className="h-2.5 w-2.5" />}
                  </span>
                  <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-xs">{h.name}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {h.model} · {h.state === "dirty" ? "uncommitted" : `applied ${h.lastApply}`}
                    </div>
                  </div>
                  {h.current ? (
                    <span className="font-semibold text-[9px] text-teal-400 uppercase tracking-wider">
                      this mac
                    </span>
                  ) : (
                    <span className="text-[9px] text-muted-foreground uppercase tracking-wider">
                      remote
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
        <div className="mt-1.5 flex gap-1 border-border/60 border-t pt-1.5">
          <ActionButton label="All" onClick={() => setSelected(new Set(hosts.map((h) => h.id)))} />
          <ActionButton label="None" onClick={() => setSelected(new Set())} />
          <ActionButton
            label="Just this Mac"
            onClick={() => {
              const cur = hosts.find((h) => h.current);
              setSelected(new Set(cur ? [cur.id] : []));
            }}
          />
        </div>
        <button
          type="button"
          className="mt-1 flex w-full items-center gap-2 rounded-md border-border/60 border-t px-2.5 py-2 text-xs text-muted-foreground hover:bg-accent"
        >
          <Plus className="h-3 w-3" /> Add host…
        </button>
      </PopoverContent>
    </Popover>
  );
}

function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded-sm px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {label}
    </button>
  );
}
