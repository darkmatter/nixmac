// Story-only helper. Renders a sibling panel that shows what prompt
// seed *would* be pushed into the textarea when a child component
// invokes its callback. Lets reviewers exercise the full UX in
// Storybook without needing the live app.
import { type ReactNode, useState } from "react";

interface SeedDisplayProps {
  /**
   * Render-prop. Receives the intercept callback to wire into your
   * component, plus the component itself sees what it normally would.
   */
  children: (push: (seed: string) => void) => ReactNode;
  /** Optional title for the seed panel. */
  title?: string;
}

export function SeedDisplay({ children, title = "Prompt seed" }: SeedDisplayProps) {
  const [history, setHistory] = useState<string[]>([]);
  const push = (seed: string) => setHistory((h) => [seed, ...h].slice(0, 5));

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "minmax(0, 1fr) 360px" }}>
      <div className="overflow-hidden rounded-lg border border-border bg-card/40">
        {children(push)}
      </div>
      <div className="rounded-lg border border-border bg-card/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-semibold text-[12px]">{title}</div>
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => setHistory([])}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              clear
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <div className="text-[11px] text-muted-foreground italic">
            Click any "Edit with a prompt" / "Track these" button — the seed will appear here.
          </div>
        ) : (
          <ol className="m-0 grid list-none gap-2 p-0">
            {history.map((seed, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: stable per render
              <li key={i} className="rounded-md border border-teal-500/20 bg-teal-500/[0.04] p-2">
                <div className="mb-1 text-[9.5px] text-muted-foreground uppercase tracking-wider">
                  {i === 0 ? "latest" : `prev #${i}`}
                </div>
                <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[11px] text-teal-200 leading-[1.5]">
                  {seed}
                </pre>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
