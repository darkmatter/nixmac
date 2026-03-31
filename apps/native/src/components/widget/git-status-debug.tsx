"use client";

// AGENT INSTRUCTIONS — read before editing this file:
// - Boolean fields from GitStatus belong in the top bar (always-visible Bool row).
// - Long-value fields (strings, hashes, arrays, counts) belong in the expanded section as FieldRow entries.
// - All labels must use the exact field name as defined on the GitStatus TypeScript type (camelCase)
//   or as defined in git.rs (snake_case) — whichever matches what you are displaying.
//   Do not abbreviate, rename, or invent names.
// - Do not add fields that are not on the GitStatus type.

import { useState } from "react";
import { useWidgetStore } from "@/stores/widget-store";

function Bool({ label, value }: { label: string; value: boolean | undefined }) {
  if (value === undefined || !value) {
    return <span className="text-white/30">{label}:✗</span>;
  }
  return <span className="text-yellow-400">{label}:✓</span>;
}

function FieldRow({ label, display, full }: { label: string; display: string; full: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  };

  return (
    <button
      className="flex min-w-0 max-w-full cursor-pointer gap-1 text-left hover:text-yellow-300"
      onClick={copy}
      title={full}
      type="button"
    >
      <span className="shrink-0 text-yellow-400/50">{label}:</span>
      <span className="overflow-hidden text-ellipsis whitespace-nowrap text-yellow-400/80">
        {copied ? "copied!" : display}
      </span>
    </button>
  );
}

export function GitStatusDebug() {
  const [expanded, setExpanded] = useState(false);
  const gitStatus = useWidgetStore((s) => s.gitStatus);

  if (!gitStatus) {
    return (
      <div
        className="rounded bg-black/80 px-2 py-1 font-mono text-xs text-yellow-400"
        style={{ backdropFilter: "blur(4px)" }}
      >
        git: null
      </div>
    );
  }

  return (
    <div
      className="space-y-0.5 rounded bg-black/80 px-2 py-1 font-mono text-xs text-yellow-400"
      style={{ backdropFilter: "blur(4px)" }}
    >
      {/* Booleans always visible */}
      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
        <Bool label="clean_head" value={gitStatus.cleanHead} />
        <button
          className="text-yellow-400/60 hover:text-yellow-400"
          onClick={() => setExpanded(!expanded)}
          type="button"
        >
          {expanded ? "▲" : "▼"}
        </button>
      </div>

      {/* Expandable: non-bool fields */}
      {expanded && (
        <div className="space-y-0.5 border-yellow-500/20 border-t pt-0.5">
          <FieldRow
            label="branch"
            display={gitStatus.branch ?? "—"}
            full={gitStatus.branch ?? ""}
          />
          <FieldRow
            label="head_commit_hash"
            display={gitStatus.headCommitHash ?? "null"}
            full={gitStatus.headCommitHash ?? "null"}
          />
        </div>
      )}
    </div>
  );
}
