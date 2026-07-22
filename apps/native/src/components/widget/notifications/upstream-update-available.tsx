"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { client } from "@/lib/orpc";
import { GitPullRequestArrow } from "lucide-react";
import { uiActions, useViewModel } from "@nixmac/state";

export function UpstreamUpdateAvailable() {
  const available = useViewModel((s) => s.build.upstreamUpdateAvailable);
  const [isUpdating, setIsUpdating] = useState(false);

  if (!available) return null;

  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      await client.git.pullFromUpstream();
    } catch (error: unknown) {
      const message = (error as Error)?.message ?? String(error);
      uiActions.setError(message);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="flex w-full shrink-0 items-center justify-between gap-2 border-amber-400/25 border-b bg-amber-500/5 px-3 py-2 text-xs">
      <span className="flex items-center gap-2">
        <GitPullRequestArrow className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
        <span>
          <span className="font-medium text-foreground">Your Git repository is behind the upstream.</span>{" "}
          <span className="text-muted-foreground">Update it before making more changes.</span>
        </span>
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isUpdating}
        onClick={() => void handleUpdate()}
        className="h-7 border-amber-300/40 bg-transparent px-2 text-xs text-amber-200 hover:border-amber-200 hover:text-amber-100"
      >
        {isUpdating ? (
          <>
            <Spinner className="h-3 w-3" />
            Updating...
          </>
        ) : (
          "Update"
        )}
      </Button>
    </div>
  );
}
