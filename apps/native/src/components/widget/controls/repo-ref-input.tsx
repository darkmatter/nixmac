"use client";

import type { ReactNode } from "react";
import { Check, Link2, TriangleAlert } from "lucide-react";
import type { ParsedFlakeRef } from "@/components/widget/onboarding/lib/flake-ref";
import { cn } from "@/lib/utils";

interface RepoRefInputProps {
  id: string;
  value: string;
  /** Parse result for `value` (callers usually memoize `parseFlakeRef`). */
  parsed: ParsedFlakeRef;
  onChange: (value: string) => void;
  /** Invoked on Enter. */
  onSubmit?: () => void;
  placeholder?: string;
  /** Hint shown before the user has typed anything. */
  idleHint?: ReactNode;
}

/**
 * Repository-reference input with live validation feedback, shared by the
 * flake-ref import source and the custom-template create flow.
 */
export function RepoRefInput({
  id,
  value,
  parsed,
  onChange,
  onSubmit,
  placeholder = "owner/repo?ref=main&dir=hosts/work",
  idleHint,
}: RepoRefInputProps) {
  const touched = value.trim().length > 0;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border bg-background px-3 py-2 transition-colors focus-within:ring-2 focus-within:ring-ring",
          touched && !parsed.valid ? "border-destructive" : "border-input",
        )}
      >
        <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit?.();
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          placeholder={placeholder}
          className="w-full bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="mt-2 min-h-5 text-xs" aria-live="polite">
        {touched && parsed.valid ? (
          <span
            className={cn(
              "flex items-center gap-1.5",
              parsed.importable ? "text-success" : "text-warning",
            )}
          >
            {parsed.importable ? (
              <Check className="size-3.5" aria-hidden="true" />
            ) : (
              <TriangleAlert className="size-3.5" aria-hidden="true" />
            )}
            <span className="font-medium">{parsed.label}</span>
            <span className="text-muted-foreground">— {parsed.hint}</span>
          </span>
        ) : touched && !parsed.valid ? (
          <span className="flex items-center gap-1.5 text-destructive">
            <TriangleAlert className="size-3.5" aria-hidden="true" />
            {parsed.hint}
          </span>
        ) : (
          <span className="text-muted-foreground">
            {idleHint ?? (
              <>
                Supports <code className="font-mono">owner/repo</code>, GitHub URLs, SSH URLs, and
                optional <code className="font-mono">?ref=</code>/
                <code className="font-mono">?dir=</code>.
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
