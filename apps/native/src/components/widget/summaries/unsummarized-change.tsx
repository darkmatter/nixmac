"use client";

import { Button } from "@/components/ui/button";
import type { ChangeFileSummary } from "@/components/widget/utils";
import { CHANGE_TYPE_STYLES, getDirectory, getShortFilename } from "@/components/widget/utils";
import { cn } from "@/lib/utils";
import { EllipsisVerticalIcon, MoveRight, Undo } from "lucide-react";
import { useState } from "react";

function FilePath({ path, role }: { path: string; role?: "old" | "new" }) {
  const dir = getDirectory(path);
  const name = getShortFilename(path);
  return (
    <span className="min-w-0 font-mono text-[11px]">
      {dir && (
        <span className={cn("text-neutral-500", role === "old" && "line-through opacity-50")}>
          {dir}/
        </span>
      )}
      <span className="font-semibold text-neutral-400">{name}</span>
    </span>
  );
}

export function UnsummarizedChange({
  changeType,
  filename,
  hunkCount,
  oldFilename,
}: ChangeFileSummary) {
  const [isOpen, setIsOpen] = useState(false);
  const { icon: Icon, iconColor } = CHANGE_TYPE_STYLES[changeType];
  return (
    <div className={cn("flex items-center gap-2 rounded-md px-2.5 py-1.5 w-full")}>
      <Icon className={cn("h-3.5 w-3.5 shrink-0 opacity-60", iconColor)} />
      {oldFilename ? (
        <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          <FilePath path={oldFilename} role="old" />
          <MoveRight className="h-3 w-3 shrink-0 text-neutral-500" />
          <FilePath path={filename} role="new" />
        </span>
      ) : (
        <FilePath path={filename} />
      )}
      {hunkCount > 1 && (
        <span className="shrink-0 rounded bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500">
          x{hunkCount}
        </span>
      )}
      <Button variant="ghost" size="icon" onClick={() => setIsOpen(!isOpen)}><EllipsisVerticalIcon /></Button>
      {isOpen && (
        <div className="absolute right-0 top-0 flex flex-col gap-1">
          <Button variant="ghost" size="icon"><Undo />Discard</Button>
        </div>
      )}
    </div>
  );
}
