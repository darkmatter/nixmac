"use client";

import { GitPullRequestArrow } from "lucide-react";
import { useViewModel } from "@nixmac/state";

export function UpstreamUpdateAvailable() {
  const available = useViewModel((s) => s.build.upstreamUpdateAvailable);

  if (!available) return null;

  return (
    <div className="flex w-full shrink-0 items-center gap-2 border-amber-400/25 border-b bg-amber-500/5 px-3 py-2 text-xs">
      <GitPullRequestArrow className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
      <span>
        <span className="font-medium text-foreground">Your Git repository is behind the upstream.</span>{" "}
        <span className="text-muted-foreground">Update it before making more changes.</span>
      </span>
    </div>
  );
}
