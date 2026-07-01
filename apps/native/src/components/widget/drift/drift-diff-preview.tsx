import { cn } from "@/lib/utils";

type DiffLineKind = "add" | "remove" | "hunk" | "meta" | "context";

/**
 * Non-content lines that git may prepend to a hunk (file headers, mode/rename
 * markers, the "no newline" note). They're colored as muted metadata so only
 * the real +/- edits stand out.
 */
const META_PREFIXES = [
  "diff --git",
  "index ",
  "--- ",
  "+++ ",
  "new file",
  "deleted file",
  "rename ",
  "similarity ",
  "old mode",
  "new mode",
  "\\ No newline",
];

function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("@@")) return "hunk";
  // Meta prefixes (incl. `+++`/`---`) must be checked before the +/- content
  // lines so file headers aren't mistaken for additions/removals.
  if (META_PREFIXES.some((prefix) => line.startsWith(prefix))) return "meta";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  return "context";
}

const LINE_STYLES: Record<DiffLineKind, string> = {
  add: "bg-emerald-500/10 text-emerald-300",
  remove: "bg-red-500/10 text-red-300",
  hunk: "bg-sky-500/8 text-sky-300/90",
  meta: "text-muted-foreground/70",
  context: "text-muted-foreground",
};

/**
 * Renders a unified-diff string as color-coded lines. Purely presentational —
 * the diff text is already available on the drift row, so no fetching or Monaco
 * runtime is needed for this compact inline preview.
 */
export function DriftDiffPreview({ diff }: { diff: string }) {
  const lines = diff.replace(/\n+$/, "").split("\n");

  return (
    <div className="max-h-80 overflow-auto border-border/50 border-t bg-background/40">
      <div className="min-w-max py-1 font-mono text-[11px] leading-[1.5]">
        {lines.map((line, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are static per render
            key={i}
            className={cn("whitespace-pre px-4", LINE_STYLES[classifyDiffLine(line)])}
          >
            {line === "" ? " " : line}
          </div>
        ))}
      </div>
    </div>
  );
}
