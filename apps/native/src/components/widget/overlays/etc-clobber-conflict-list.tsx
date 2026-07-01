import type {
  EtcClobberCheckResult,
  EtcClobberConflictKind,
  ManagedFileRoot,
} from "@/ipc/types";
import { cn } from "@/lib/utils";

const CONFLICT_KIND_LABELS = {
  unrecognized_content: "Unrecognized content",
  non_regular_target: "Not a regular file",
  unreadable: "Unreadable",
} satisfies Record<EtcClobberConflictKind, string>;

const CONFLICT_KIND_DESCRIPTIONS = {
  unrecognized_content:
    "nix-darwin does not recognize this file as one it can safely adopt.",
  non_regular_target:
    "nix-darwin only adopts regular files or the exact expected symlink.",
  unreadable:
    "nixmac could not inspect this path, so it is treated as unsafe.",
} satisfies Record<EtcClobberConflictKind, string>;

const MANAGED_ROOT_LABELS = {
  etc: "/etc",
  xdg_config: "~/.config",
} satisfies Record<ManagedFileRoot, string>;

interface EtcClobberConflictListProps {
  result: EtcClobberCheckResult;
  className?: string;
}

export function EtcClobberConflictList({ result, className }: EtcClobberConflictListProps) {
  const hasConflicts = result.conflicts.length > 0;
  const hasWarnings = result.warnings.length > 0;

  if (!hasConflicts && !hasWarnings) {
    return null;
  }

  return (
    <div className={cn("space-y-3", className)}>
      {hasConflicts && (
        <div className="w-full max-w-xl overflow-hidden rounded-lg border border-amber-300/20 bg-amber-300/5 text-left">
          <div className="border-amber-300/15 border-b px-4 py-3">
            <p className="font-medium text-amber-100 text-sm">
              {result.conflicts.length} /etc {result.conflicts.length === 1 ? "file" : "files"} need your review
            </p>
            <p className="mt-1 text-amber-100/70 text-xs">
              Checked {result.checked} managed entries before activation.
            </p>
          </div>

          <ul className="max-h-44 divide-y divide-white/10 overflow-y-auto">
            {result.conflicts.map((conflict) => (
              <li key={`${conflict.path}:${conflict.kind}`} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-black/30 px-2 py-1 font-mono text-amber-50 text-xs">
                    {conflict.path}
                  </code>
                  <span className="shrink-0 rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 font-medium text-[10px] text-amber-100 uppercase tracking-wide">
                    {CONFLICT_KIND_LABELS[conflict.kind]}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-300">
                  {CONFLICT_KIND_DESCRIPTIONS[conflict.kind]}
                </p>
                {conflict.currentLinkTarget && (
                  <p className="truncate text-[11px] text-zinc-500">
                    Current link: <code>{conflict.currentLinkTarget}</code>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasWarnings && (
        <div className="w-full max-w-xl overflow-hidden rounded-lg border border-sky-300/20 bg-sky-300/5 text-left">
          <div className="border-sky-300/15 border-b px-4 py-3">
            <p className="font-medium text-sky-100 text-sm">
              {result.warnings.length} managed {result.warnings.length === 1 ? "file" : "files"} will be backed up
            </p>
            <p className="mt-1 text-sky-100/70 text-xs">
              Activation moves each existing file aside before linking the generated version.
            </p>
          </div>

          <ul className="max-h-44 divide-y divide-white/10 overflow-y-auto">
            {result.warnings.map((warning) => (
              <li key={`${warning.path}:${warning.managedRoot}`} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-black/30 px-2 py-1 font-mono text-sky-50 text-xs">
                    {warning.path}
                  </code>
                  <span className="shrink-0 rounded-full border border-sky-300/25 bg-sky-300/10 px-2 py-0.5 font-medium text-[10px] text-sky-100 uppercase tracking-wide">
                    {MANAGED_ROOT_LABELS[warning.managedRoot]}
                  </span>
                </div>
                {warning.backupExtension && (
                  <p className="truncate text-[11px] text-zinc-400">
                    Backed up as <code>{`${warning.target}.${warning.backupExtension}`}</code>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
